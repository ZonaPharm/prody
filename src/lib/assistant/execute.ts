/**
 * Carrying out a proposal after the person pressed the button on its card.
 *
 * The card may have been edited (quantities, prices, a row removed), so what
 * comes back is checked again here, and only within what was proposed: a
 * delivery or order keeps to the proposed products, a product change to the
 * proposed fields. The writes go through the same database functions as the
 * screens (save_delivery_draft, save_supplier_order) with this person as the
 * author, and each one is written to the activity log.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logAction } from '@/lib/audit'
import { factoryBarcodeProblem, normalizeCode } from '@/lib/barcodes'
import { LABEL_KINDS } from '@/lib/label-kind'
import { missingLabelKind } from '@/lib/deliveries/label-kind-compat'
import { productChangesSchema, type ActionCard } from './actions'
import { randomUUID } from 'crypto'
import { readPending, removePending } from './uploads'

type Db = SupabaseClient<any, any, any>
export type Actor = { id: string; name: string }
export type Outcome =
  | { ok: true; result: { url?: string; label?: string; text: string; id?: string; image_url?: string } }
  /** `proposal`: the card as it should now read (new products made before a failed draft are kept, not made twice). */
  | { ok: false; error: string; proposal?: any }

const uuid = z.string().uuid()
const money = z.number().min(0).max(1_000_000)
const qty = z.number().int().min(1).max(1_000_000)

const newProduct = z.object({
  name: z.string().trim().min(2, 'Името е поне 2 знака').max(200),
  sale_price: z.number().positive('Продажната цена трябва да е над 0').max(1_000_000),
  label_kind: z.enum(LABEL_KINDS).nullable().optional(),
})

export const confirmSchemas = {
  delivery_draft: z.object({
    supplier_id: uuid.nullable().optional(),
    document_number: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(z.object({
      product_id: uuid.nullable().optional(),
      new_product: newProduct.nullable().optional(),
      quantity: qty,
      unit_cost: money,
    })).min(1, 'Няма нито един ред').max(300),
  }),
  supplier_order: z.object({
    supplier_id: uuid,
    notes: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(z.object({ product_id: uuid, quantity: qty, note: z.string().trim().max(300).nullable().optional() }))
      .min(1, 'Няма нито един ред').max(500),
  }),
  product_create: z.object({
    product: z.object({
      name: z.string().trim().min(2, 'Името е поне 2 знака').max(200),
      price: z.number().positive('Продажната цена трябва да е над 0').max(1_000_000),
      cost_price: money.nullable().optional(),
      barcode: z.string().trim().max(48).nullable().optional(),
      category_id: uuid.nullable().optional(),
      supplier_id: uuid.nullable().optional(),
      min_quantity: z.number().int().min(0).max(100_000).default(5),
      label_kind: z.enum(LABEL_KINDS).default('full'),
      small_item: z.boolean().default(false),
      description: z.string().trim().max(5000).nullable().optional(),
    }),
  }),
  product_update: z.object({ after: productChangesSchema }),
  product_image: z.object({ main: z.boolean() }),
} as const

export type ConfirmKind = keyof typeof confirmSchemas

export function isConfirmable(kind: string): kind is ConfirmKind {
  return kind in confirmSchemas
}

/** Checks the edited card against the proposal: same products, same fields. */
export function withinProposal(kind: ConfirmKind, proposal: any, edited: any): string | null {
  if (kind === 'delivery_draft') {
    const allowed = new Set((proposal.lines || []).map((l: any) => l.product_id).filter(Boolean))
    const hadNew = (proposal.lines || []).some((l: any) => l.new_product)
    for (const l of edited.lines) {
      if (!!l.product_id === !!l.new_product) return 'Всеки ред е или продукт от каталога, или нов продукт.'
      if (l.product_id && !allowed.has(l.product_id)) return 'Ред с продукт, който не беше в предложението.'
      if (l.new_product && !hadNew) return 'Нов продукт, който не беше в предложението.'
    }
    if ((edited.supplier_id ?? null) !== (proposal.supplier_id ?? null)) return 'Доставчикът не може да се сменя оттук.'
  }
  if (kind === 'supplier_order') {
    const allowed = new Set((proposal.lines || []).map((l: any) => l.product_id))
    if (edited.supplier_id !== proposal.supplier_id) return 'Доставчикът не може да се сменя оттук.'
    if (edited.lines.some((l: any) => !allowed.has(l.product_id))) return 'Ред с продукт, който не беше в предложението.'
  }
  if (kind === 'product_update') {
    const fields = Object.keys(proposal.diff || {})
    const extra = Object.keys(edited.after).filter(k => !fields.includes(k))
    if (extra.length) return 'Поле, което не беше в предложението.'
    if (!Object.keys(edited.after).length) return 'Не е избрана нито една промяна.'
  }
  return null
}

async function supplierName(db: Db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data } = await (db.from('suppliers') as any).select('name').eq('id', id).maybeSingle()
  return data?.name ?? null
}

/** Inserts a product; falls back to needs_label alone before the label_kind migration. */
async function insertProduct(db: Db, row: Record<string, unknown>): Promise<{ id: string } | { error: string }> {
  const insert = (r: Record<string, unknown>) => (db.from('products') as any).insert(r).select('id').single()
  let { data, error } = await insert(row)
  if (missingLabelKind(error)) {
    const rest = { ...row }
    delete rest.label_kind
    ;({ data, error } = await insert(rest))
  }
  if (error) {
    if (error.code === '23505' && /barcode|баркод/i.test(error.message ?? '')) return { error: 'Този баркод вече е на друг продукт.' }
    return { error: error.message || 'Продуктът не можа да се създаде.' }
  }
  return { id: data.id }
}

function rpcError(error: any, fallback: string): string {
  const msg = error?.message as string | undefined
  // The database functions raise their reasons in Bulgarian; anything else stays generic.
  return msg && /[а-яА-Я]/.test(msg) ? msg : fallback
}

export async function execute(db: Db, actor: Actor, action: ActionCard, kind: ConfirmKind, edited: any): Promise<Outcome> {
  const meta = { via: 'ai_assistant', action_id: action.id }

  if (kind === 'delivery_draft') {
    const supplier = await supplierName(db, edited.supplier_id)
    // If something fails after new products were made, the card keeps them as catalogue rows.
    const keep = () => ({ ...action.payload, lines: [...lines, ...edited.lines.slice(lines.length)].map((l: any) => ({ ...l, product_name: l.product_name ?? null })) })
    // New products first: a draft line needs a product id.
    const created: string[] = []
    const items: any[] = []
    const lines: any[] = []
    for (const l of edited.lines) {
      let productId = l.product_id
      if (!productId) {
        const kind = l.new_product.label_kind ?? 'full'
        const made = await insertProduct(db, {
          name: l.new_product.name, price: l.new_product.sale_price, source: supplier, status: 'active',
          quantity_on_hand: 0, min_quantity: 5, needs_label: kind === 'full', label_kind: kind,
        })
        if ('error' in made) return { ok: false, error: `Нов продукт „${l.new_product.name}“: ${made.error}`, proposal: created.length ? keep() : undefined }
        productId = made.id
        created.push(l.new_product.name)
        lines.push({ ...l, product_id: made.id, product_name: l.new_product.name, new_product: null })
        await logAction({ action: 'create_product', userId: actor.id, userName: actor.name, entityType: 'product', entityId: made.id, details: `${l.new_product.name} (от AI асистента)`, metadata: meta }, db as any)
      } else {
        lines.push(l)
      }
      items.push({
        id: null, key: null, product_id: productId, supplier_id: edited.supplier_id ?? null,
        doc_number: edited.document_number ?? null, pack_size: 1, quantity: l.quantity, unit_cost: l.unit_cost,
        needs_label: null, plan: [],
      })
    }
    const { data, error } = await (db as any).rpc('save_delivery_draft', {
      p_delivery_id: null, p_user: actor.id, p_expected_updated_at: null,
      p_draft: { order_ref: edited.document_number ?? null, notes: edited.notes ?? null, items },
    })
    if (error) {
      const made = created.length ? ` Новите продукти (${created.join(', ')}) вече са създадени.` : ''
      return { ok: false, error: rpcError(error, 'Черновата не можа да се запише.') + made, proposal: created.length ? keep() : undefined }
    }
    await logAction({ action: 'delivery_draft_from_assistant', userId: actor.id, userName: actor.name, entityType: 'delivery', entityId: data.id, details: `${items.length} реда${supplier ? ', ' + supplier : ''}`, metadata: meta }, db as any)
    return { ok: true, result: { url: `/deliveries/${data.id}`, label: 'Отвори черновата', text: `Черновата е създадена: ${items.length} реда${created.length ? `, ${created.length} нови продукта` : ''}. Нататък: разпределение и „Запази“ в Доставки.`, id: data.id } }
  }

  if (kind === 'supplier_order') {
    const { data, error } = await (db as any).rpc('save_supplier_order', {
      p_order_id: null, p_user: actor.id, p_expected_updated_at: null,
      p_order: { supplier_id: edited.supplier_id, notes: edited.notes ?? null, items: edited.lines.map((l: any) => ({ product_id: l.product_id, quantity: l.quantity, note: l.note ?? null })) },
    })
    if (error) return { ok: false, error: rpcError(error, 'Поръчката не можа да се запише.') }
    await logAction({ action: 'supplier_order_from_assistant', userId: actor.id, userName: actor.name, entityType: 'supplier_order', entityId: data.id, details: `${edited.lines.length} реда`, metadata: meta }, db as any)
    const num = data.number != null ? `ПР-${String(data.number).padStart(6, '0')}` : 'чернова'
    return { ok: true, result: { url: `/deliveries/orders/${data.id}`, label: 'Отвори поръчката', text: `Поръчката е записана (${num}). Изпраща се от „Поръчки“.` } }
  }

  if (kind === 'product_create') {
    const p = edited.product
    const code = normalizeCode(p.barcode)
    if (code) {
      const problem = factoryBarcodeProblem(code)
      if (problem) return { ok: false, error: `Баркод: ${problem}` }
    }
    const made = await insertProduct(db, {
      name: p.name, price: p.price, cost_price: p.cost_price ?? null, barcode: code || null,
      category_id: p.category_id ?? null, source: await supplierName(db, p.supplier_id), status: 'active',
      quantity_on_hand: 0, min_quantity: p.min_quantity, needs_label: p.label_kind === 'full', label_kind: p.label_kind,
      small_item: p.small_item, description: p.description ?? null,
    })
    if ('error' in made) return { ok: false, error: made.error }
    await logAction({ action: 'create_product', userId: actor.id, userName: actor.name, entityType: 'product', entityId: made.id, details: `${p.name} (от AI асистента)`, metadata: meta }, db as any)
    return { ok: true, result: { url: `/catalog/${made.id}`, label: 'Отвори продукта', text: 'Продуктът е създаден, без наличност. Стоката идва с доставка.' } }
  }

  if (kind === 'product_image') return addProductImage(db, actor, action, edited.main, meta)

  // product_update
  const proposal = action.payload
  const patch: Record<string, unknown> = { ...edited.after }
  if ('barcode' in patch) {
    const code = normalizeCode(patch.barcode as string)
    const problem = code ? factoryBarcodeProblem(code) : null
    if (problem) return { ok: false, error: `Баркод: ${problem}` }
    patch.barcode = code || null
  }
  if ('label_kind' in patch) patch.needs_label = patch.label_kind === 'full'
  if (patch.status === 'active') patch.inactive_reason = null
  // Only if nobody changed the product since the proposal.
  let q = (db.from('products') as any).update(patch).eq('id', proposal.product_id)
  if (proposal.updated_at) q = q.eq('updated_at', proposal.updated_at)
  const { data, error } = await q.select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Този баркод вече е на друг продукт.' }
    return { ok: false, error: error.message || 'Промяната не можа да се запише.' }
  }
  if (!data?.length) return { ok: false, error: 'Продуктът е променен след предложението. Помолете асистента да го погледне пак.' }
  await logAction({ action: 'update_product', userId: actor.id, userName: actor.name, entityType: 'product', entityId: proposal.product_id, details: `${proposal.product_name}: ${Object.keys(edited.after).join(', ')} (от AI асистента)`, metadata: { ...meta, after: edited.after } }, db as any)
  return { ok: true, result: { url: `/catalog/${proposal.product_id}`, label: 'Отвори продукта', text: 'Промяната е записана.' } }
}

/** The product's photos are public files in the "products" bucket, like the ones added on the product form. */
const PRODUCT_BUCKET = 'products'

async function addProductImage(db: Db, actor: Actor, action: ActionCard, main: boolean, meta: Record<string, unknown>): Promise<Outcome> {
  const p = action.payload
  const storage = (db as any).storage
  const { data: product } = await (db.from('products') as any).select('id, name').eq('id', p.product_id).maybeSingle()
  if (!product) return { ok: false, error: 'Продуктът вече го няма.' }
  const bytes = await readPending(storage, p.pending_path)
  if (!bytes) return { ok: false, error: 'Подготвената снимка вече я няма (пази се един ден). Прикачете я отново.' }

  const path = `${product.id}/ai-${randomUUID()}.webp`
  const { error: upErr } = await storage.from(PRODUCT_BUCKET).upload(path, bytes, { contentType: 'image/webp', upsert: false })
  if (upErr) return { ok: false, error: 'Снимката не можа да се качи. Опитайте пак.' }
  const url: string = storage.from(PRODUCT_BUCKET).getPublicUrl(path).data.publicUrl

  const { data: images } = await (db.from('product_images') as any).select('id, is_primary, sort_order').eq('product_id', product.id)
  const list = (images ?? []) as { id: string; is_primary: boolean; sort_order: number }[]
  const primary = main || list.length === 0
  const { data: row, error } = await (db.from('product_images') as any).insert({
    product_id: product.id, url, is_primary: false,
    sort_order: list.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1) + 1,
  }).select('id').single()
  if (error) {
    await storage.from(PRODUCT_BUCKET).remove([path]).catch(() => {})
    return { ok: false, error: 'Снимката не можа да се запише към продукта.' }
  }
  // The new one becomes the main photo only once it is safely saved; then no product is left without one.
  if (primary) {
    await (db.from('product_images') as any).update({ is_primary: false }).eq('product_id', product.id).neq('id', row.id)
    await (db.from('product_images') as any).update({ is_primary: true }).eq('id', row.id)
  }
  await removePending(storage, p.pending_path)
  await logAction({ action: 'update_product', userId: actor.id, userName: actor.name, entityType: 'product', entityId: product.id, details: `${product.name}: нова снимка${primary ? ' (главна)' : ''} (от AI асистента)`, metadata: { ...meta, image_id: row.id } }, db as any)
  return { ok: true, result: { url: `/catalog/${product.id}`, label: 'Отвори продукта', text: primary ? 'Снимката е добавена като главна.' : 'Снимката е добавена към продукта.', id: row.id, image_url: url } }
}
