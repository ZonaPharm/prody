/**
 * What the assistant may PREPARE, never do. Each "propose_" tool checks what the
 * model asked for against the database, stores it in ai_actions as a proposal
 * and shows it as a card. Nothing in the shop changes until the person presses
 * the card's button (execute.ts). The only table these tools write is
 * ai_actions.
 *
 * make_file builds an Excel table or a printable document. Its numbers come
 * from the read-only tools in tools.ts, run here on the server, not from the
 * model's text.
 */
import { z } from 'zod'
import { fetchByIds } from '@/lib/fetch-all'
import { factoryBarcodeProblem, normalizeCode } from '@/lib/barcodes'
import { LABEL_KINDS } from '@/lib/label-kind'
import { PRODUCT_FIELDS, type ActionCard, type ActionKind, type ProductField } from './cards'

export { PRODUCT_FIELDS, type ActionCard, type ActionKind, type ProductField } from './cards'
import { READ_TOOLS, fail, parseToolInput, rows, type AssistantTool, type ToolContext } from './tools'
import { clip, searchTerm } from './util'

const uuid = z.string().uuid()
const price = z.number().min(0).max(1_000_000)
const qty = z.number().int().min(1).max(1_000_000)

export const productChangesSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  price: z.number().positive().max(1_000_000).optional(),
  cost_price: price.nullable().optional(),
  min_quantity: z.number().int().min(0).max(100_000).optional(),
  barcode: z.string().trim().max(48).nullable().optional(),
  category_id: uuid.nullable().optional(),
  label_kind: z.enum(LABEL_KINDS).optional(),
  small_item: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
})
export type ProductChanges = z.infer<typeof productChangesSchema>

function noActContext(ctx: ToolContext) {
  return ctx.act ? null : { error: 'Тук не може да се подготвят промени.' }
}

async function storeCard(ctx: ToolContext, kind: ActionKind, title: string, payload: unknown, done = false): Promise<ActionCard> {
  const act = ctx.act!
  const now = new Date().toISOString()
  const { data, error } = await (ctx.db.from('ai_actions') as any).insert({
    conversation_id: act.conversationId,
    question_seq: act.questionSeq,
    user_id: act.userId,
    kind,
    title: clip(title, 200),
    payload,
    status: done ? 'done' : 'proposed',
    ...(done ? { done_at: now, done_by: act.userId, result: { made: true } } : {}),
  }).select('id, kind, title, status, payload, result').single()
  if (error) throw error
  const card = data as ActionCard
  act.emit(card)
  return card
}

const PROPOSED = 'Показах картата на човека. Нищо не е записано: той трябва да прегледа и да натисне бутона. Кажи му това с едно изречение и не твърди, че е направено.'

async function productsById(ctx: ToolContext, ids: string[]) {
  const list = await fetchByIds<any>(chunk => (ctx.db.from('products') as any)
    .select('id, name, price, cost_price, barcode, status').in('id', chunk), [...new Set(ids)])
  return new Map(list.map(p => [p.id, p]))
}

async function supplierById(ctx: ToolContext, id: string | null | undefined) {
  if (!id) return null
  const { data } = await (ctx.db.from('suppliers') as any).select('id, name, is_active').eq('id', id).maybeSingle()
  return data as { id: string; name: string; is_active: boolean } | null
}

// ---------------------------------------------------------------------------
// Helpers for reading a document: suppliers, categories, products by line.
// ---------------------------------------------------------------------------

const suppliers: AssistantTool = {
  name: 'suppliers',
  description: 'Доставчиците в Prody (id, име, активен ли е). Ползвай го, за да намериш доставчика от документ.',
  status: 'Гледам доставчиците…',
  schema: z.object({}),
  async run({ db }) {
    const list = await rows((db.from('suppliers') as any).select('id, name, is_active').order('name'))
    return { suppliers: list.map((s: any) => ({ id: s.id, name: s.name, active: s.is_active !== false })) }
  },
}

const categories: AssistantTool = {
  name: 'categories',
  description: 'Категориите на продуктите (id, име, родител). За нов продукт или смяна на категория.',
  status: 'Гледам категориите…',
  schema: z.object({}),
  async run({ db }) {
    const list = await rows((db.from('categories') as any).select('id, name, parent_id').order('name'))
    return { categories: list.map((c: any) => ({ id: c.id, name: c.name, parent_id: c.parent_id })) }
  },
}

/** The two longest words of a name (3+ letters), for a loose match against the catalogue. */
export function keyWords(name: string): string[] {
  const words = searchTerm(name).split(/[\s/.\-]+/).filter(w => w.length >= 3 && !/^\d+([.,]\d+)?(mg|g|ml|бр|таб|капс)?$/i.test(w))
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2)
}

const matchProducts: AssistantTool = {
  name: 'match_products',
  description:
    'Намира продуктите от редовете на документ (фактура, стокова) в каталога: първо по баркод, после по думи от името. ' +
    'Дай всички редове наведнъж. За всеки ред връща до 3 кандидата; ако няма съвпадение, продуктът вероятно е нов.',
  status: 'Търся продуктите от документа…',
  schema: z.object({
    lines: z.array(z.object({
      ref: z.string().max(20).describe('Номер на реда в документа'),
      barcode: z.string().max(48).optional(),
      name: z.string().max(300).optional(),
    })).min(1).max(200),
  }),
  async run(ctx, { lines }) {
    const cols = 'id, name, barcode, internal_barcode, price, cost_price, status'
    const codes = [...new Set(lines.map((l: any) => normalizeCode(l.barcode)).filter(Boolean))] as string[]
    const byCode = new Map<string, any>()
    if (codes.length) {
      const [a, b] = await Promise.all([
        fetchByIds<any>(c => (ctx.db.from('products') as any).select(cols).in('barcode', c), codes),
        fetchByIds<any>(c => (ctx.db.from('products') as any).select(cols).in('internal_barcode', c), codes),
      ])
      for (const p of [...a, ...b]) {
        if (p.barcode) byCode.set(normalizeCode(p.barcode), p)
        if (p.internal_barcode) byCode.set(normalizeCode(p.internal_barcode), p)
      }
    }
    const show = (p: any) => ({ id: p.id, name: p.name, barcode: p.barcode, price: p.price, cost_price: p.cost_price, active: p.status === 'active' })
    const out: any[] = []
    // A few name searches at a time, so a long invoice does not flood the database.
    for (let i = 0; i < lines.length; i += 8) {
      const batch = await Promise.all(lines.slice(i, i + 8).map(async (l: any) => {
        const hit = byCode.get(normalizeCode(l.barcode))
        if (hit) return { ref: l.ref, match: 'barcode', candidates: [show(hit)] }
        const words = keyWords(l.name || '')
        if (!words.length) return { ref: l.ref, match: 'none', candidates: [] }
        let q = (ctx.db.from('products') as any).select(cols)
        for (const w of words) q = q.ilike('name', `%${w}%`)
        let found = await rows(q.order('name').limit(3))
        if (!found.length && words.length > 1) found = await rows((ctx.db.from('products') as any).select(cols).ilike('name', `%${words[0]}%`).order('name').limit(3))
        return { ref: l.ref, match: found.length ? 'name' : 'none', candidates: found.map(show) }
      }))
      out.push(...batch)
    }
    return { lines: out, note: 'Съвпадение по име е само предположение: провери името и разфасовката.' }
  },
}

// ---------------------------------------------------------------------------
// Proposals.
// ---------------------------------------------------------------------------

const newProductInput = z.object({
  name: z.string().trim().min(2).max(200),
  sale_price: z.number().positive().max(1_000_000).describe('Продажна цена в евро'),
  label_kind: z.enum(LABEL_KINDS).optional().describe('full = пълен етикет, price = само цена, none = готов'),
})

export const deliveryLineSchema = z.object({
  product_id: uuid.optional().describe('id от каталога; празно за нов продукт'),
  new_product: newProductInput.optional(),
  quantity: qty,
  unit_cost: price.describe('Доставна цена за брой С ДДС, в евро'),
  doc_text: z.string().max(300).optional().describe('Редът, както е в документа'),
})

const proposeDelivery: AssistantTool = {
  name: 'propose_delivery_draft',
  description:
    'Подготвя ЧЕРНОВА на доставка (например от фактура или стокова) и я показва като карта с бутон. Не записва нищо: ' +
    'човекът преглежда и потвърждава. Всеки ред е или product_id от каталога, или new_product. unit_cost е цената за брой С ДДС.',
  status: 'Подготвям черновата на доставката…',
  schema: z.object({
    supplier_id: uuid.nullable().optional(),
    document_number: z.string().trim().max(100).optional().describe('Номер на фактурата / стоковата'),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(deliveryLineSchema).min(1).max(300),
  }),
  async run(ctx, input) {
    const no = noActContext(ctx); if (no) return no
    if (!ctx.act!.deliveries) return { error: 'Доставките не са включени за този човек.' }
    const bad = input.lines.findIndex((l: any) => !!l.product_id === !!l.new_product)
    if (bad >= 0) return { error: `Ред ${bad + 1}: трябва или product_id, или new_product (точно едно от двете).` }
    const supplier = await supplierById(ctx, input.supplier_id)
    if (input.supplier_id && !supplier) return { error: 'Няма доставчик с този id. Виж suppliers.' }
    const products = await productsById(ctx, input.lines.filter((l: any) => l.product_id).map((l: any) => l.product_id))
    const missing = input.lines.find((l: any) => l.product_id && !products.has(l.product_id))
    if (missing) return { error: `Няма продукт с id ${missing.product_id}. Провери с match_products.` }
    const lines = input.lines.map((l: any) => {
      const p = l.product_id ? products.get(l.product_id) : null
      return {
        product_id: l.product_id ?? null,
        product_name: p?.name ?? null,
        last_cost: p?.cost_price ?? null,
        new_product: l.new_product ?? null,
        quantity: l.quantity,
        unit_cost: l.unit_cost,
        doc_text: l.doc_text ?? null,
      }
    })
    const total = lines.reduce((s: number, l: any) => s + l.quantity * l.unit_cost, 0)
    const card = await storeCard(ctx, 'delivery_draft',
      `Чернова на доставка${supplier ? ' от ' + supplier.name : ''}${input.document_number ? ', док. ' + input.document_number : ''}`,
      { supplier_id: supplier?.id ?? null, supplier_name: supplier?.name ?? null, document_number: input.document_number ?? null, notes: input.notes ?? null, lines, total: Math.round(total * 100) / 100 })
    return { ok: true, card_id: card.id, lines: lines.length, new_products: lines.filter((l: any) => l.new_product).length, told: PROPOSED }
  },
}

const proposeOrder: AssistantTool = {
  name: 'propose_supplier_order',
  description:
    'Подготвя ЧЕРНОВА на поръчка към доставчик и я показва като карта с бутон. Не изпраща и не записва нищо: ' +
    'човекът преглежда, потвърждава и после я праща от „Поръчки“. Само продукти от каталога.',
  status: 'Подготвям поръчката…',
  schema: z.object({
    supplier_id: uuid,
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(z.object({ product_id: uuid, quantity: qty, note: z.string().trim().max(300).optional() })).min(1).max(500),
  }),
  async run(ctx, input) {
    const no = noActContext(ctx); if (no) return no
    if (!ctx.act!.deliveries) return { error: 'Поръчките към доставчици не са включени за този човек.' }
    const supplier = await supplierById(ctx, input.supplier_id)
    if (!supplier) return { error: 'Няма доставчик с този id. Виж suppliers.' }
    const products = await productsById(ctx, input.lines.map((l: any) => l.product_id))
    const missing = input.lines.find((l: any) => !products.has(l.product_id))
    if (missing) return { error: `Няма продукт с id ${missing.product_id}.` }
    const lines = input.lines.map((l: any) => ({ product_id: l.product_id, product_name: products.get(l.product_id).name, quantity: l.quantity, note: l.note ?? null }))
    const card = await storeCard(ctx, 'supplier_order', `Поръчка към ${supplier.name}`,
      { supplier_id: supplier.id, supplier_name: supplier.name, notes: input.notes ?? null, lines })
    return { ok: true, card_id: card.id, told: PROPOSED }
  },
}

/** Name of the product that already has this code (factory or internal), if any. */
async function barcodeTaken(ctx: ToolContext, code: string, exceptId?: string): Promise<string | null> {
  // Two plain .eq() lookups: a code may hold characters that or() would read as syntax.
  for (const col of ['barcode', 'internal_barcode']) {
    let q = (ctx.db.from('products') as any).select('id, name').eq(col, code).limit(1)
    if (exceptId) q = q.neq('id', exceptId)
    const [hit] = await rows(q)
    if (hit) return (hit as any).name
  }
  return null
}

const proposeNewProduct: AssistantTool = {
  name: 'propose_new_product',
  description:
    'Подготвя НОВ продукт и го показва като карта с бутон „Създай“. Не записва нищо. Наличност не се въвежда: ' +
    'стоката идва само с доставка. Първо провери с find_products, че го няма.',
  status: 'Подготвям новия продукт…',
  schema: z.object({
    name: z.string().trim().min(2).max(200),
    price: z.number().positive().max(1_000_000).describe('Продажна цена в евро'),
    cost_price: price.optional().describe('Доставна цена с ДДС'),
    barcode: z.string().trim().max(48).optional().describe('Фабричният баркод от опаковката'),
    category_id: uuid.optional(),
    supplier_id: uuid.optional(),
    min_quantity: z.number().int().min(0).max(100_000).optional(),
    label_kind: z.enum(LABEL_KINDS).optional(),
    small_item: z.boolean().optional(),
    description: z.string().trim().max(5000).optional(),
  }),
  async run(ctx, input) {
    const no = noActContext(ctx); if (no) return no
    const code = normalizeCode(input.barcode)
    if (code) {
      const problem = factoryBarcodeProblem(code)
      if (problem) return { error: `Баркод: ${problem}` }
      const taken = await barcodeTaken(ctx, code)
      if (taken) return { error: `Баркодът ${code} вече е на продукта „${taken}“. Не създавай нов.` }
    }
    const supplier = await supplierById(ctx, input.supplier_id)
    let category: string | null = null
    if (input.category_id) {
      const { data } = await (ctx.db.from('categories') as any).select('name').eq('id', input.category_id).maybeSingle()
      if (!data) return { error: 'Няма категория с този id. Виж categories.' }
      category = data.name
    }
    const [same] = await rows((ctx.db.from('products') as any).select('id, name').ilike('name', searchTerm(input.name)).limit(1))
    const product = {
      name: input.name,
      price: input.price,
      cost_price: input.cost_price ?? null,
      barcode: code || null,
      category_id: input.category_id ?? null,
      category_name: category,
      supplier_id: supplier?.id ?? null,
      supplier_name: supplier?.name ?? null,
      min_quantity: input.min_quantity ?? 5,
      label_kind: input.label_kind ?? (code ? 'price' : 'full'),
      small_item: input.small_item ?? false,
      description: input.description ?? null,
    }
    const card = await storeCard(ctx, 'product_create', `Нов продукт: ${input.name}`,
      { product, warning: same ? `Има продукт със същото име: „${(same as any).name}“.` : null })
    return { ok: true, card_id: card.id, same_name_exists: !!same, told: PROPOSED }
  },
}

/** Only the fields that really change, as {field: [before, after]}. */
export function productDiff(current: Record<string, any>, changes: ProductChanges): Partial<Record<ProductField, [any, any]>> {
  const out: Partial<Record<ProductField, [any, any]>> = {}
  for (const [k, v] of Object.entries(changes) as [ProductField, any][]) {
    if (v === undefined || !(k in PRODUCT_FIELDS)) continue
    const before = current[k] ?? null
    const after = k === 'barcode' ? (normalizeCode(v) || null) : v
    const same = typeof before === 'number' || typeof after === 'number' ? Number(before) === Number(after) && before != null && after != null : before === after
    if (!same) out[k] = [before, after]
  }
  return out
}

const PRODUCT_COLUMNS = 'id, name, description, price, cost_price, min_quantity, barcode, category_id, label_kind, small_item, status, updated_at'

const proposeProductChange: AssistantTool = {
  name: 'propose_product_change',
  description:
    'Подготвя ПРОМЯНА на продукт (цена, име, доставна цена, минимум, баркод, категория, етикет, статус) и я показва като ' +
    'карта „преди → след“ с бутон „Запиши“. Не записва нищо. Наличността не се сменя оттук (тя е през инвентаризация).',
  status: 'Подготвям промяната…',
  schema: z.object({ product_id: uuid, changes: productChangesSchema }),
  async run(ctx, { product_id, changes }) {
    const no = noActContext(ctx); if (no) return no
    let { data: current, error } = await (ctx.db.from('products') as any).select(PRODUCT_COLUMNS).eq('id', product_id).maybeSingle()
    // Before migration 20261112_product_label_kind there is no label_kind column.
    if (error && /label_kind/.test(error.message ?? '')) {
      ;({ data: current, error } = await (ctx.db.from('products') as any).select(PRODUCT_COLUMNS.replace(', label_kind', '')).eq('id', product_id).maybeSingle())
    }
    if (error) throw error
    if (!current) return { error: 'Няма продукт с този id.' }
    if (changes.barcode) {
      const problem = factoryBarcodeProblem(changes.barcode)
      if (problem) return { error: `Баркод: ${problem}` }
      const taken = await barcodeTaken(ctx, normalizeCode(changes.barcode), product_id)
      if (taken) return { error: `Баркодът вече е на продукта „${taken}“.` }
    }
    const diff = productDiff(current, changes)
    if (!Object.keys(diff).length) return { error: 'Нищо не се променя: стойностите са същите.' }
    const names: Record<string, string> = {}
    const catIds = [diff.category_id?.[0], diff.category_id?.[1]].filter(Boolean) as string[]
    if (catIds.length) {
      const cats = await rows((ctx.db.from('categories') as any).select('id, name').in('id', catIds))
      if (diff.category_id?.[1] && !cats.some((c: any) => c.id === diff.category_id![1])) return { error: 'Няма категория с този id.' }
      for (const c of cats as any[]) names[c.id] = c.name
    }
    const card = await storeCard(ctx, 'product_update', `Промяна на „${current.name}“`, {
      product_id, product_name: current.name, updated_at: current.updated_at, diff, names,
    })
    return { ok: true, card_id: card.id, changes: Object.keys(diff), told: PROPOSED }
  },
}

// ---------------------------------------------------------------------------
// Files: Excel and a printable document.
// ---------------------------------------------------------------------------

export const MAX_FILE_ROWS = 5000

/** The rows of a read tool's answer: the array at `key` (a.b.c), or the first list of objects. */
export function pickRows(out: unknown, key?: string): Record<string, unknown>[] | null {
  let v: any = out
  if (key) {
    for (const k of key.split('.')) v = v?.[k]
    return Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : null
  }
  const queue: any[] = [out]
  while (queue.length) {
    const cur = queue.shift()
    if (Array.isArray(cur)) {
      if (cur.length && cur.every(r => r && typeof r === 'object' && !Array.isArray(r))) return cur
      continue
    }
    if (cur && typeof cur === 'object') queue.push(...Object.values(cur))
  }
  return null
}

/** Nested objects become "a.b" columns; lists become text. */
export function flatRow(row: Record<string, unknown>, prefix = '', out: Record<string, string | number | boolean | null> = {}) {
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v == null) out[key] = null
    else if (Array.isArray(v)) out[key] = v.map(x => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
    else if (typeof v === 'object') flatRow(v as Record<string, unknown>, key, out)
    else out[key] = v as string | number | boolean
  }
  return out
}

const cell = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])

const makeFile: AssistantTool = {
  name: 'make_file',
  description:
    'Прави файл за изтегляне: format "excel" (таблици, всяка на свой лист), "word" (.docx за редактиране) или "pdf" (за печат и пращане). ' +
    'Всеки файл може после да се изтегли и в другите два вида, затова прави един файл, не три. ' +
    'Таблица с данни от Prody: дай from = {tool, input} с някоя от справките (напр. sales_summary) и колони; числата се взимат ' +
    'направо от базата. rows дай само за данни, които не са в Prody (напр. разчетени от прикачен документ).',
  status: 'Правя файла…',
  schema: z.object({
    format: z.enum(['excel', 'word', 'pdf', 'document']),
    title: z.string().trim().min(1).max(150),
    intro: z.string().trim().max(5000).optional(),
    sections: z.array(z.object({
      heading: z.string().trim().max(200).optional(),
      text: z.string().trim().max(10000).optional(),
      table: z.object({
        from: z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}) }).optional(),
        rows_key: z.string().max(100).optional().describe('Кой списък от отговора на справката, напр. "groups"'),
        rows: z.array(z.record(z.string(), cell)).max(MAX_FILE_ROWS).optional(),
        columns: z.array(z.object({ key: z.string().max(100), title: z.string().max(100) })).max(40).optional(),
      }).optional(),
    })).min(1).max(10),
  }),
  async run(ctx, input) {
    const no = noActContext(ctx); if (no) return no
    const sections: any[] = []
    for (const [i, s] of input.sections.entries()) {
      let table: { columns: { key: string; title: string }[]; rows: Record<string, unknown>[]; source: string } | null = null
      if (s.table) {
        let raw: Record<string, unknown>[] | null = null
        let source = 'разговора'
        if (s.table.from) {
          const tool = READ_TOOLS.find(t => t.name === s.table.from.tool)
          if (!tool) return { error: `Раздел ${i + 1}: няма справка ${s.table.from.tool}.` }
          const parsed = parseToolInput(tool, s.table.from.input)
          if (!parsed.ok) return { error: `Раздел ${i + 1}: ${parsed.error}` }
          let out: unknown
          try { out = await tool.run(ctx, parsed.data) } catch (err) { return fail(err) }
          if (out && typeof out === 'object' && 'error' in (out as any)) return out as any
          raw = pickRows(out, s.table.rows_key)
          if (!raw) return { error: `Раздел ${i + 1}: в отговора на ${tool.name} няма такъв списък${s.table.rows_key ? ` (${s.table.rows_key})` : ''}.` }
          source = `Prody, справка ${tool.name}`
        } else if (s.table.rows) {
          raw = s.table.rows
        } else {
          return { error: `Раздел ${i + 1}: таблицата иска from или rows.` }
        }
        const flat = (raw ?? []).slice(0, MAX_FILE_ROWS).map(r => flatRow(r))
        const keys = [...new Set(flat.flatMap(r => Object.keys(r)))]
        const columns: { key: string; title: string }[] = s.table.columns?.length ? s.table.columns : keys.map(k => ({ key: k, title: k }))
        const unknown = columns.filter(c => !keys.includes(c.key)).map(c => c.key)
        if (flat.length && unknown.length) return { error: `Раздел ${i + 1}: няма колони ${unknown.join(', ')}. Има: ${keys.join(', ')}.` }
        table = { columns, rows: flat, source }
      }
      sections.push({ heading: s.heading ?? null, text: s.text ?? null, table })
    }
    const kind = input.format === 'excel' ? 'excel' : 'document'
    const format = input.format === 'excel' ? 'xlsx' : input.format === 'word' ? 'docx' : 'pdf'
    const card = await storeCard(ctx, kind, input.title, { title: input.title, intro: input.intro ?? null, sections, format }, true)
    return {
      ok: true, card_id: card.id,
      tables: sections.filter(s => s.table).map(s => ({ heading: s.heading, rows: s.table.rows.length })),
      told: 'Файлът е готов и под отговора има бутон за изтегляне. Кажи го с едно изречение.',
    }
  },
}

export const ACTION_TOOLS: AssistantTool[] = [
  suppliers, categories, matchProducts, proposeDelivery, proposeOrder, proposeNewProduct, proposeProductChange, makeFile,
]

