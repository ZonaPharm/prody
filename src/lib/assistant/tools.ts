/**
 * The assistant's tools. Every one of them only READS, through fixed queries
 * with chosen columns. There is no free SQL, nothing writes, nothing sends
 * mail and nothing leaves the server except the answer.
 *
 * Never read here: email_settings (mail password), the auth schema, any key or
 * token, users' e-mail addresses. Sums are computed here, not by the model.
 *
 * Every tool returns a JSON string. A failed read comes back as
 * {"error": "..."} so the model can say what it could not check.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/fetch-all'
import { isMissingTableError } from '@/lib/missing-table'
import { runIntegrityCheck } from '@/lib/integrity-check'
import { sofiaDateTime } from '@/lib/date-utils'
import { rolesOf, rolesText } from '@/lib/roles'
import {
  clip, dateRange, money, one, searchTerm, summariseSales, timestampRange, toolJson,
  type GroupKey, type SaleRow,
} from './util'

type Db = SupabaseClient<any, any, any>

export type ToolContext = {
  db: Db
  /** Names of stores and people, loaded once per question. */
  names: () => Promise<Names>
  /** Present when the assistant may propose changes and make files (actions.ts). */
  act?: ActContext
}

/** Who is asking and where proposals go; see actions.ts. */
export type ActContext = {
  userId: string
  userName: string
  conversationId: string
  /** The question these proposals answer, so the screen shows them after its answer. */
  questionSeq: number
  /** Deliveries and orders to suppliers are switched on for this person. */
  deliveries: boolean
  /** Shows a card on the screen as soon as it is ready. */
  emit: (card: unknown) => void
}

type Names = { store: (id: string | null | undefined) => string | null; person: (id: string | null | undefined) => string | null }

export function namesLoader(db: Db): () => Promise<Names> {
  let loaded: Promise<Names> | null = null
  return () => {
    loaded ??= (async () => {
      const [{ data: stores }, { data: users }] = await Promise.all([
        (db.from('stores') as any).select('id, name'),
        (db.from('users') as any).select('id, display_name'),
      ])
      const s = new Map<string, string>((stores || []).map((r: any) => [r.id, r.name]))
      const u = new Map<string, string>((users || []).map((r: any) => [r.id, r.display_name]))
      return {
        store: id => (id ? s.get(id) ?? id : null),
        person: id => (id ? u.get(id) ?? id : null),
      }
    })()
    return loaded
  }
}

export type AssistantTool = {
  name: string
  description: string
  schema: z.ZodObject<any>
  /** What the screen shows while this runs, e.g. „Проверявам продажбите…“. */
  status: string
  run: (ctx: ToolContext, input: any) => Promise<unknown>
}

const uuid = z.string().uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const limit = (max: number, def: number) => z.number().int().min(1).max(max).default(def)

export function fail(err: unknown): { error: string } {
  if (isMissingTableError(err)) return { error: 'Тази част още я няма в базата (миграцията не е пусната тук).' }
  const msg = (err as any)?.message
  return { error: `Четенето не успя${msg ? ': ' + clip(msg, 200) : ''}.` }
}

export async function rows<T = any>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await q
  if (error) throw error
  return data || []
}

const fmtDelivery = (n: number | null) => (n == null ? 'Чернова' : `Д-${String(n).padStart(6, '0')}`)
const fmtShipment = (n: number | null) => (n == null ? '' : `П-${String(n).padStart(6, '0')}`)
const fmtTrip = (n: number | null) => (n == null ? '' : `К-${String(n).padStart(6, '0')}`)
const fmtOrder = (n: number | null) => (n == null ? '' : `ПР-${String(n).padStart(6, '0')}`)
const when = (ts: string | null | undefined) => (ts ? sofiaDateTime(ts) : null)

/** Accepts "Д-000123", "123", "к-12" and returns 123. */
export function parseNumber(v: string | number): number | null {
  const m = String(v).match(/(\d+)\s*$/)
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------------------

const peopleAndStores: AssistantTool = {
  name: 'people_and_stores',
  description:
    'Списък на обектите (магазини и Офис) и на хората в Prody: име, роли, обект, активен ли е. ' +
    'Ползвай го, за да намериш id на обект или човек по име. Няма имейли и пароли.',
  status: 'Гледам обектите и хората…',
  schema: z.object({}),
  async run({ db }) {
    const [stores, users] = await Promise.all([
      rows((db.from('stores') as any).select('id, name, is_active').order('name')),
      // '*' because users.roles arrives with migration 20261112_user_roles and may
      // not be there yet; only the fields below go on to the model (no e-mail).
      rows((db.from('users') as any).select('*').order('display_name')),
    ])
    const storeName = new Map(stores.map((s: any) => [s.id, s.name]))
    return {
      stores: stores.map((s: any) => ({ id: s.id, name: s.name, active: s.is_active !== false })),
      people: users.map((u: any) => ({
        id: u.id,
        name: u.display_name,
        roles: rolesText(rolesOf(u)),
        store: u.store_id ? storeName.get(u.store_id) ?? null : null,
        active: u.is_active !== false,
      })),
    }
  },
}

const findProducts: AssistantTool = {
  name: 'find_products',
  description:
    'Търси продукти по част от името или точно по SKU / баркод / вътрешен баркод. ' +
    'Връща id, цена, доставна цена, статус, обща наличност и минимално количество.',
  status: 'Търся продукта…',
  schema: z.object({
    query: z.string().min(1).describe('Част от името или точен баркод/SKU'),
    include_inactive: z.boolean().default(false),
    limit: limit(50, 20),
  }),
  async run({ db }, { query, include_inactive, limit: n }) {
    const q = searchTerm(query)
    if (!q) return { error: 'Празно търсене.' }
    let b = (db.from('products') as any)
      .select('id, name, sku, barcode, internal_barcode, price, cost_price, status, quantity_on_hand, min_quantity')
      .or(`name.ilike.%${q}%,sku.eq.${q},barcode.eq.${q},internal_barcode.eq.${q}`)
      .order('name')
      .limit(n)
    if (!include_inactive) b = b.eq('status', 'active')
    const list = await rows(b)
    return { count: list.length, products: list }
  },
}

const productStock: AssistantTool = {
  name: 'product_stock',
  description:
    'Наличността на един продукт по обекти и по партиди (FIFO), с доставните цени на партидите. ' +
    'Показва и дали общият брояч съвпада със сбора от партидите.',
  status: 'Проверявам наличността…',
  schema: z.object({ product_id: uuid }),
  async run({ db, names }, { product_id }) {
    const [{ data: product, error }, batches, nm] = await Promise.all([
      (db.from('products') as any)
        .select('id, name, price, cost_price, status, quantity_on_hand, min_quantity')
        .eq('id', product_id).maybeSingle(),
      rows((db.from('stock_batches') as any)
        .select('id, store_id, quantity_remaining, unit_cost, created_at')
        .eq('product_id', product_id).gt('quantity_remaining', 0)
        .order('created_at').order('id')),
      names(),
    ])
    if (error) throw error
    if (!product) return { error: 'Няма такъв продукт.' }
    const perStore = new Map<string, number>()
    for (const b of batches) perStore.set(b.store_id, (perStore.get(b.store_id) || 0) + b.quantity_remaining)
    const total = [...perStore.values()].reduce((a, v) => a + v, 0)
    return {
      product,
      batches_total: total,
      counter_matches_batches: total === product.quantity_on_hand,
      by_store: [...perStore.entries()].map(([id, qty]) => ({ store: nm.store(id), store_id: id, qty })),
      batches: batches.map((b: any) => ({
        store: nm.store(b.store_id), qty: b.quantity_remaining, unit_cost: Number(b.unit_cost), since: when(b.created_at),
      })),
    }
  },
}

const storeStock: AssistantTool = {
  name: 'store_stock',
  description:
    'Какво има в един обект: продукти с количество и стойност по доставна цена. ' +
    'По избор само продукти под минималното количество или търсене по име.',
  status: 'Гледам наличностите в обекта…',
  schema: z.object({
    store_id: uuid,
    query: z.string().optional().describe('Част от името на продукта'),
    only_below_min: z.boolean().default(false),
    limit: limit(300, 100),
  }),
  async run({ db, names }, { store_id, query, only_below_min, limit: n }) {
    const q = query ? searchTerm(query) : ''
    const batches = await fetchAll<any>(() => {
      let b = (db.from('stock_batches') as any)
        .select('product_id, quantity_remaining, unit_cost, product:products!inner(name, min_quantity, status)')
        .eq('store_id', store_id).gt('quantity_remaining', 0)
      if (q) b = b.ilike('product.name', `%${q}%`)
      return b.order('id')
    })
    const map = new Map<string, { name: string; qty: number; value: number; min: number | null }>()
    for (const b of batches) {
      const p = one<any>(b.product)
      const e = map.get(b.product_id) ?? { name: p?.name ?? b.product_id, qty: 0, value: 0, min: p?.min_quantity ?? null }
      e.qty += b.quantity_remaining
      e.value += b.quantity_remaining * Number(b.unit_cost)
      map.set(b.product_id, e)
    }
    let list = [...map.entries()].map(([id, e]) => ({ product_id: id, name: e.name, qty: e.qty, min_quantity: e.min, value_at_cost: money(e.value) }))
    if (only_below_min) list = list.filter(p => p.min_quantity != null && p.qty < p.min_quantity)
    list.sort((a, b) => a.name.localeCompare(b.name, 'bg'))
    const nm = await names()
    return {
      store: nm.store(store_id),
      products_total: list.length,
      units_total: list.reduce((a, p) => a + p.qty, 0),
      value_at_cost_total: money(list.reduce((a, p) => a + p.value_at_cost, 0)),
      note: only_below_min ? 'Продукти с 0 бр. в обекта не излизат тук (нямат партида).' : undefined,
      products: list.slice(0, n),
      truncated: list.length > n,
    }
  },
}

const salesFilters = {
  date_from: isoDate.optional().describe('ГГГГ-ММ-ДД; по подразбиране преди 30 дни'),
  date_to: isoDate.optional().describe('ГГГГ-ММ-ДД; по подразбиране днес'),
  store_id: uuid.optional(),
  seller_id: uuid.optional(),
  product_id: uuid.optional(),
}

function salesQuery(db: Db, cols: string, f: any, from: string, to: string) {
  let b = (db.from('sales') as any).select(cols).gte('sale_date', from).lte('sale_date', to)
  if (f.store_id) b = b.eq('store_id', f.store_id)
  if (f.seller_id) b = b.eq('sold_by', f.seller_id)
  if (f.product_id) b = b.eq('product_id', f.product_id)
  return b
}

const salesSummary: AssistantTool = {
  name: 'sales_summary',
  description:
    'Сборове на продажбите за период (оборот = количество × продажна цена, както в Отчети; без анулираните), ' +
    'по избор групирани по ден, обект, продавач, продукт или начин на плащане. Казва и колко са анулираните. ' +
    'До 366 дни наведнъж.',
  status: 'Смятам продажбите…',
  schema: z.object({
    ...salesFilters,
    group_by: z.enum(['none', 'day', 'store', 'seller', 'product', 'payment_method']).default('none'),
    top: limit(200, 50).describe('Колко групи да върне'),
  }),
  async run({ db, names }, input) {
    const r = dateRange(input.date_from, input.date_to, { defaultDays: 30, maxDays: 366 })
    if ('error' in r) return r
    const cols = 'quantity, sale_price, sale_date, store_id, sold_by, product_id, payment_method'
    const [ok, voided, nm] = await Promise.all([
      fetchAll<SaleRow>(() => salesQuery(db, cols, input, r.from, r.to).eq('voided', false).order('id')),
      fetchAll<SaleRow>(() => salesQuery(db, 'quantity, sale_price', input, r.from, r.to).eq('voided', true).order('id')),
      names(),
    ])
    const groupBy = input.group_by as GroupKey
    let productNames = new Map<string, string>()
    if (groupBy === 'product') {
      const ids = [...new Set(ok.map(s => s.product_id))]
      const prods = ids.length
        ? await fetchAll<any>(() => (db.from('products') as any).select('id, name').order('id'))
        : []
      const want = new Set(ids)
      productNames = new Map(prods.filter((p: any) => want.has(p.id)).map((p: any) => [p.id, p.name]))
    }
    const label = (k: string) =>
      groupBy === 'store' ? nm.store(k) ?? k
      : groupBy === 'seller' ? nm.person(k) ?? k
      : groupBy === 'product' ? productNames.get(k) ?? k
      : k
    const s = summariseSales(ok, groupBy, label)
    return {
      period: r,
      revenue: s.revenue,
      units: s.units,
      sale_lines: s.lines,
      voided: { lines: voided.length, revenue: money(voided.reduce((a, v) => a + v.quantity * Number(v.sale_price), 0)) },
      groups: groupBy === 'none' ? undefined : s.groups.slice(0, input.top),
      groups_total: groupBy === 'none' ? undefined : s.groups.length,
    }
  },
}

const listSales: AssistantTool = {
  name: 'list_sales',
  description:
    'Отделните продажби (редове) за период: кога, кой продавач, в кой обект, продукт, количество, цена, ' +
    'плащане, анулирана ли е и от кого. Най-новите първи, до 200.',
  status: 'Гледам продажбите една по една…',
  schema: z.object({
    ...salesFilters,
    only_voided: z.boolean().default(false),
    limit: limit(200, 50),
  }),
  async run({ db, names }, input) {
    const r = dateRange(input.date_from, input.date_to, { defaultDays: 7, maxDays: 366 })
    if ('error' in r) return r
    let b = salesQuery(db,
      'id, created_at, sale_date, store_id, sold_by, quantity, sale_price, payment_method, notes, voided, voided_at, voided_by, sale_group_id, product:products(name)',
      input, r.from, r.to)
    if (input.only_voided) b = b.eq('voided', true)
    const list = await rows(b.order('created_at', { ascending: false }).limit(input.limit))
    const nm = await names()
    return {
      period: r,
      count: list.length,
      sales: list.map((s: any) => ({
        id: s.id,
        at: when(s.created_at),
        sale_date: s.sale_date,
        store: nm.store(s.store_id),
        seller: nm.person(s.sold_by),
        product: one<any>(s.product)?.name ?? null,
        qty: s.quantity,
        price: Number(s.sale_price),
        payment: s.payment_method || 'cash',
        receipt: s.sale_group_id,
        notes: clip(s.notes),
        voided: s.voided ? { at: when(s.voided_at), by: nm.person(s.voided_by) } : false,
      })),
    }
  },
}

const stockHistory: AssistantTool = {
  name: 'stock_history',
  description:
    'Историята на стоката: движенията (заприхождаване, продажба, прехвърляне…) с кой и кога, ' +
    'и корекциите при инвентаризация с причината. По продукт и/или обект, за период (по подразбиране 30 дни).',
  status: 'Проследявам движенията на стоката…',
  schema: z.object({
    product_id: uuid.optional(),
    store_id: uuid.optional(),
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    limit: limit(200, 100),
  }),
  async run({ db, names }, input) {
    if (!input.product_id && !input.store_id) return { error: 'Посочете продукт или обект.' }
    const r = dateRange(input.date_from, input.date_to, { defaultDays: 30, maxDays: 366 })
    if ('error' in r) return r
    const { fromTs, toTs } = timestampRange(r)
    const scope = (b: any) => {
      if (input.product_id) b = b.eq('product_id', input.product_id)
      if (input.store_id) b = b.eq('store_id', input.store_id)
      return b.gte('created_at', fromTs).lt('created_at', toTs)
    }
    const [moves, corrections, nm] = await Promise.all([
      rows(scope((db.from('stock_movements') as any)
        .select('created_at, type, quantity, unit_cost, unit_price, store_id, source_store_id, created_by, notes, product:products(name)'))
        .order('created_at', { ascending: false }).limit(input.limit)),
      rows(scope((db.from('stock_corrections') as any)
        .select('created_at, store_id, old_quantity, new_quantity, difference, reason, notes, created_by, product:products(name)'))
        .order('created_at', { ascending: false }).limit(input.limit)).catch(() => [] as any[]),
      names(),
    ])
    return {
      period: r,
      movements: moves.map((m: any) => ({
        at: when(m.created_at), type: m.type, qty: m.quantity, product: one<any>(m.product)?.name ?? null,
        store: nm.store(m.store_id), from_store: nm.store(m.source_store_id), by: nm.person(m.created_by),
        unit_cost: m.unit_cost == null ? null : Number(m.unit_cost),
        unit_price: m.unit_price == null ? null : Number(m.unit_price),
        notes: clip(m.notes),
      })),
      corrections: corrections.map((c: any) => ({
        at: when(c.created_at), product: one<any>(c.product)?.name ?? null, store: nm.store(c.store_id),
        from_qty: c.old_quantity, to_qty: c.new_quantity, difference: c.difference, reason: c.reason,
        by: nm.person(c.created_by), notes: clip(c.notes),
      })),
    }
  },
}

const listDeliveries: AssistantTool = {
  name: 'list_deliveries',
  description: 'Доставките от доставчици за период: номер (Д-…), статус, кой я въведе, редове, бройки и стойност.',
  status: 'Гледам доставките…',
  schema: z.object({
    status: z.enum(['draft', 'expected', 'in_progress', 'completed', 'cancelled']).optional(),
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    limit: limit(100, 30),
  }),
  async run({ db, names }, input) {
    const r = dateRange(input.date_from, input.date_to, { defaultDays: 60, maxDays: 731 })
    if ('error' in r) return r
    const { fromTs, toTs } = timestampRange(r)
    let b = (db.from('deliveries') as any)
      .select('id, number, status, order_ref, notes, created_by, created_at, completed_at, cancelled_at, cancel_reason, delivery_items(quantity, received_qty, unit_cost)')
      .gte('created_at', fromTs).lt('created_at', toTs)
    if (input.status) b = b.eq('status', input.status)
    const list = await rows(b.order('created_at', { ascending: false }).limit(input.limit))
    const nm = await names()
    return {
      period: r,
      deliveries: list.map((d: any) => {
        const items: any[] = d.delivery_items || []
        return {
          number: fmtDelivery(d.number), status: d.status, created: when(d.created_at), by: nm.person(d.created_by),
          completed: when(d.completed_at), cancelled: d.cancelled_at ? { at: when(d.cancelled_at), reason: clip(d.cancel_reason) } : undefined,
          order_ref: clip(d.order_ref, 80), notes: clip(d.notes),
          lines: items.length,
          units: items.reduce((a, i) => a + i.quantity, 0),
          received_units: items.reduce((a, i) => a + i.received_qty, 0),
          value: money(items.reduce((a, i) => a + i.quantity * Number(i.unit_cost), 0)),
        }
      }),
    }
  },
}

const deliveryDetails: AssistantTool = {
  name: 'delivery_details',
  description:
    'Всичко за една доставка по номер (Д-000123 или 123): редове с доставчик, документ, бройки, приети и цена; ' +
    'разпределението по обекти (планирано / готово / изпратено); пълният дневник на събитията с кой и кога; проблемите („Не е наред“).',
  status: 'Отварям доставката…',
  schema: z.object({ number: z.union([z.string(), z.number()]) }),
  async run({ db, names }, { number }) {
    const n = parseNumber(number)
    if (n == null) return { error: 'Не разпознах номера на доставката.' }
    const { data: d, error } = await (db.from('deliveries') as any)
      .select('id, number, status, order_ref, notes, created_by, created_at, completed_at, cancelled_at, cancelled_by, cancel_reason')
      .eq('number', n).maybeSingle()
    if (error) throw error
    if (!d) return { error: `Няма доставка ${fmtDelivery(n)}.` }
    const [items, events, signals, nm] = await Promise.all([
      rows((db.from('delivery_items') as any)
        .select('id, quantity, received_qty, unit_cost, pack_size, doc_number, product:products(name), supplier:suppliers(name), delivery_item_plan(store_id, planned_qty, ready_qty, shipped_qty)')
        .eq('delivery_id', d.id).order('sort_order')),
      rows((db.from('delivery_events') as any)
        .select('type, store_id, qty, details, created_by, created_at, delivery_item_id')
        .eq('delivery_id', d.id).order('created_at').limit(500)),
      rows((db.from('delivery_signals') as any)
        .select('step, reason, qty_expected, qty_actual, note, status, resolution, resolution_note, created_by, created_at, resolved_by, resolved_at')
        .eq('delivery_id', d.id).order('created_at')),
      names(),
    ])
    const itemName = new Map(items.map((i: any) => [i.id, one<any>(i.product)?.name ?? null]))
    return {
      number: fmtDelivery(d.number), status: d.status, created: when(d.created_at), by: nm.person(d.created_by),
      completed: when(d.completed_at), order_ref: clip(d.order_ref, 80), notes: clip(d.notes),
      cancelled: d.cancelled_at ? { at: when(d.cancelled_at), by: nm.person(d.cancelled_by), reason: clip(d.cancel_reason) } : undefined,
      items: items.map((i: any) => ({
        product: one<any>(i.product)?.name ?? null, supplier: one<any>(i.supplier)?.name ?? null,
        doc: clip(i.doc_number, 60), qty: i.quantity, received: i.received_qty, unit_cost: Number(i.unit_cost), pack_size: i.pack_size,
        plan: (i.delivery_item_plan || []).map((p: any) => ({
          store: nm.store(p.store_id), planned: p.planned_qty, ready: p.ready_qty, shipped: p.shipped_qty,
        })),
      })),
      events: events.map((e: any) => ({
        at: when(e.created_at), type: e.type, by: nm.person(e.created_by), store: nm.store(e.store_id), qty: e.qty,
        product: e.delivery_item_id ? itemName.get(e.delivery_item_id) ?? null : null,
        details: e.details && Object.keys(e.details).length ? clip(e.details, 400) : undefined,
      })),
      problems: signals.map((s: any) => ({
        at: when(s.created_at), step: s.step, reason: s.reason, expected: s.qty_expected, actual: s.qty_actual,
        note: clip(s.note), by: nm.person(s.created_by), status: s.status,
        resolution: s.resolution ?? undefined, resolution_note: clip(s.resolution_note),
        resolved: s.resolved_at ? { at: when(s.resolved_at), by: nm.person(s.resolved_by) } : undefined,
      })),
    }
  },
}

const tripsAndShipments: AssistantTool = {
  name: 'trips_and_shipments',
  description:
    'Курсовете (К-…) и пратките към обектите (П-…) за период: шофьор, статус, кой опакова/изпрати/прие и кога, ' +
    'кутии, редове и бройки. По избор само един курс или една пратка по номер.',
  status: 'Гледам курсовете и пратките…',
  schema: z.object({
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    trip_number: z.union([z.string(), z.number()]).optional(),
    shipment_number: z.union([z.string(), z.number()]).optional(),
    store_id: uuid.optional(),
    limit: limit(100, 30),
  }),
  async run({ db, names }, input) {
    const nm = await names()
    let tripIds: string[] | null = null
    let shipmentFilter: number | null = null
    if (input.trip_number != null) {
      const n = parseNumber(input.trip_number)
      const t = n == null ? [] : await rows((db.from('trips') as any).select('id').eq('number', n))
      if (!t.length) return { error: 'Няма такъв курс.' }
      tripIds = t.map((x: any) => x.id)
    }
    if (input.shipment_number != null) {
      shipmentFilter = parseNumber(input.shipment_number)
      if (shipmentFilter == null) return { error: 'Не разпознах номера на пратката.' }
    }
    let b = (db.from('shipments') as any)
      .select('number, status, store_id, box_count, packed_by, packed_at, sent_by, sent_at, received_by, received_at, created_at, trip:trips(number, status, driver_id, departed_at, completed_at, notes), shipment_lines(qty, received_qty, product:products(name))')
    if (tripIds) b = b.in('trip_id', tripIds)
    else if (shipmentFilter != null) b = b.eq('number', shipmentFilter)
    else {
      const r = dateRange(input.date_from, input.date_to, { defaultDays: 14, maxDays: 366 })
      if ('error' in r) return r
      const { fromTs, toTs } = timestampRange(r)
      b = b.gte('created_at', fromTs).lt('created_at', toTs)
    }
    if (input.store_id) b = b.eq('store_id', input.store_id)
    const list = await rows(b.order('created_at', { ascending: false }).limit(input.limit))
    const detailed = shipmentFilter != null || tripIds != null
    return {
      shipments: list.map((s: any) => {
        const t = one<any>(s.trip)
        const lines: any[] = s.shipment_lines || []
        return {
          shipment: fmtShipment(s.number), store: nm.store(s.store_id), status: s.status, boxes: s.box_count,
          trip: t ? { number: fmtTrip(t.number), status: t.status, driver: nm.person(t.driver_id), departed: when(t.departed_at), completed: when(t.completed_at), notes: clip(t.notes) } : null,
          packed: s.packed_at ? { at: when(s.packed_at), by: nm.person(s.packed_by) } : null,
          sent: s.sent_at ? { at: when(s.sent_at), by: nm.person(s.sent_by) } : null,
          received: s.received_at ? { at: when(s.received_at), by: nm.person(s.received_by) } : null,
          lines: lines.length,
          units: lines.reduce((a, l) => a + l.qty, 0),
          items: detailed ? lines.map(l => ({ product: one<any>(l.product)?.name ?? null, qty: l.qty, received: l.received_qty })) : undefined,
        }
      }),
    }
  },
}

const stockRequests: AssistantTool = {
  name: 'stock_requests',
  description:
    'Заявките на обектите за стока: продукт, обект, кой и кога я направи, количество, статус и стъпките ' +
    '(приета, на път, доставена, отказана) с бележките. За период, по обект или статус.',
  status: 'Гледам заявките…',
  schema: z.object({
    status: z.string().optional().describe('напр. pending, accepted, in_transit, delivered, rejected'),
    store_id: uuid.optional(),
    product_id: uuid.optional(),
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    with_history: z.boolean().default(false).describe('И стъпките на всяка заявка'),
    limit: limit(100, 30),
  }),
  async run({ db, names }, input) {
    const r = dateRange(input.date_from, input.date_to, { defaultDays: 30, maxDays: 366 })
    if ('error' in r) return r
    const { fromTs, toTs } = timestampRange(r)
    let b = (db.from('stock_requests') as any)
      .select('id, store_id, requested_by, requested_qty, status, notes, created_at, accepted_at, in_transit_at, delivered_at, product:products(name)')
      .gte('created_at', fromTs).lt('created_at', toTs)
    if (input.status) b = b.eq('status', input.status)
    if (input.store_id) b = b.eq('store_id', input.store_id)
    if (input.product_id) b = b.eq('product_id', input.product_id)
    const list = await rows(b.order('created_at', { ascending: false }).limit(input.limit))
    const nm = await names()
    const history = new Map<string, any[]>()
    if (input.with_history && list.length) {
      const ev = await rows((db.from('request_events') as any)
        .select('request_id, status, user_id, notes, created_at')
        .in('request_id', list.map((x: any) => x.id)).order('created_at'))
      for (const e of ev) {
        const arr = history.get(e.request_id) ?? []
        arr.push({ at: when(e.created_at), status: e.status, by: nm.person(e.user_id), notes: clip(e.notes) })
        history.set(e.request_id, arr)
      }
    }
    return {
      period: r,
      requests: list.map((x: any) => ({
        product: one<any>(x.product)?.name ?? null, store: nm.store(x.store_id), by: nm.person(x.requested_by),
        qty: x.requested_qty, status: x.status, notes: clip(x.notes), created: when(x.created_at),
        accepted: when(x.accepted_at), in_transit: when(x.in_transit_at), delivered: when(x.delivered_at),
        history: input.with_history ? history.get(x.id) ?? [] : undefined,
      })),
    }
  },
}

const problems: AssistantTool = {
  name: 'problems',
  description: 'Сигналите „Не е наред“ по доставките и пратките (липса, повреда, грешен продукт…): отворени или решени.',
  status: 'Гледам проблемите…',
  schema: z.object({ status: z.enum(['open', 'resolved', 'all']).default('open'), limit: limit(100, 50) }),
  async run({ db, names }, { status, limit: n }) {
    let b = (db.from('delivery_signals') as any)
      .select('step, reason, qty_expected, qty_actual, note, status, resolution, resolution_note, created_by, created_at, resolved_by, resolved_at, delivery:deliveries(number), shipment:shipments(number, store_id), item:delivery_items(product:products(name))')
    if (status !== 'all') b = b.eq('status', status)
    const list = await rows(b.order('created_at', { ascending: false }).limit(n))
    const nm = await names()
    return {
      problems: list.map((s: any) => {
        const sh = one<any>(s.shipment)
        return {
          at: when(s.created_at), step: s.step, reason: s.reason, expected: s.qty_expected, actual: s.qty_actual,
          note: clip(s.note), by: nm.person(s.created_by), status: s.status,
          delivery: one<any>(s.delivery) ? fmtDelivery(one<any>(s.delivery).number) : null,
          shipment: sh ? `${fmtShipment(sh.number)} → ${nm.store(sh.store_id)}` : null,
          product: one<any>(one<any>(s.item)?.product)?.name ?? null,
          resolution: s.resolution ?? undefined, resolution_note: clip(s.resolution_note),
          resolved: s.resolved_at ? { at: when(s.resolved_at), by: nm.person(s.resolved_by) } : undefined,
        }
      }),
    }
  },
}

const supplierOrders: AssistantTool = {
  name: 'supplier_orders',
  description: 'Поръчките към доставчици (ПР-…): доставчик, статус, кой и кога я прати, редове, свързана доставка.',
  status: 'Гледам поръчките към доставчици…',
  schema: z.object({
    status: z.enum(['draft', 'sent', 'received', 'cancelled']).optional(),
    with_items: z.boolean().default(false),
    limit: limit(100, 30),
  }),
  async run({ db, names }, { status, with_items, limit: n }) {
    let b = (db.from('supplier_orders') as any)
      .select('number, status, notes, created_by, created_at, sent_at, sent_by, sent_via, received_at, received_by, cancelled_at, cancel_reason, supplier:suppliers(name), delivery:deliveries(number), supplier_order_items(quantity, note, product:products(name))')
    if (status) b = b.eq('status', status)
    const list = await rows(b.order('created_at', { ascending: false }).limit(n))
    const nm = await names()
    return {
      orders: list.map((o: any) => ({
        number: fmtOrder(o.number), supplier: one<any>(o.supplier)?.name ?? null, status: o.status,
        created: when(o.created_at), by: nm.person(o.created_by), notes: clip(o.notes),
        sent: o.sent_at ? { at: when(o.sent_at), by: nm.person(o.sent_by), via: o.sent_via } : null,
        received: o.received_at ? { at: when(o.received_at), by: nm.person(o.received_by) } : null,
        cancelled: o.cancelled_at ? { at: when(o.cancelled_at), reason: clip(o.cancel_reason) } : undefined,
        delivery: one<any>(o.delivery) ? fmtDelivery(one<any>(o.delivery).number) : null,
        lines: (o.supplier_order_items || []).length,
        items: with_items ? (o.supplier_order_items || []).map((i: any) => ({ product: one<any>(i.product)?.name ?? null, qty: i.quantity, note: clip(i.note) })) : undefined,
      })),
    }
  },
}

const activityLog: AssistantTool = {
  name: 'activity_log',
  description:
    'Дневникът на Prody: кой какво е направил (действия) и входовете/изходите (вход). ' +
    'За период (по подразбиране 7 дни), по човек, вид или търсене в описанието. Най-новите първи.',
  status: 'Чета дневника…',
  schema: z.object({
    type: z.enum(['action', 'auth', 'all']).default('all'),
    user_id: uuid.optional(),
    search: z.string().optional().describe('Дума от действието или описанието'),
    date_from: isoDate.optional(),
    date_to: isoDate.optional(),
    limit: limit(200, 100),
  }),
  async run({ db }, input) {
    const r = dateRange(input.date_from, input.date_to, { defaultDays: 7, maxDays: 366 })
    if ('error' in r) return r
    const { fromTs, toTs } = timestampRange(r)
    let b = (db.from('audit_logs') as any)
      .select('created_at, type, action, user_name, entity_type, details, status')
      .gte('created_at', fromTs).lt('created_at', toTs)
    if (input.type !== 'all') b = b.eq('type', input.type)
    if (input.user_id) b = b.eq('user_id', input.user_id)
    const q = input.search ? searchTerm(input.search) : ''
    if (q) b = b.or(`action.ilike.%${q}%,details.ilike.%${q}%`)
    const list = await rows(b.order('created_at', { ascending: false }).limit(input.limit))
    return {
      period: r,
      count: list.length,
      entries: list.map((e: any) => ({
        at: when(e.created_at), type: e.type, action: e.action, who: e.user_name, what: e.entity_type,
        details: clip(e.details, 400), status: e.status ?? undefined,
      })),
    }
  },
}

const integrity: AssistantTool = {
  name: 'data_integrity_check',
  description:
    'Пуска сега същата проверка за цялост, която върви всяка нощ: броячите срещу партидите, ' +
    'продажби без движение, зависнали доставки и пратки. Само чете.',
  status: 'Пускам проверката на данните…',
  schema: z.object({}),
  async run() {
    const report = await runIntegrityCheck()
    return {
      ok: report.ok,
      stats: report.stats,
      findings: report.findings.map(f => ({ ...f, detail: (f.detail || []).slice(0, 30).map(d => clip(d, 300)) })),
    }
  },
}

/** The tools that only read. The ones that propose changes or make files are in actions.ts. */
export const READ_TOOLS: AssistantTool[] = [
  peopleAndStores, findProducts, productStock, storeStock, salesSummary, listSales, stockHistory,
  listDeliveries, deliveryDetails, tripsAndShipments, stockRequests, problems, supplierOrders,
  activityLog, integrity,
]

function jsonSchema(schema: z.ZodObject<any>): any {
  const out = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  delete out.$schema
  return out
}

/** Tool definitions in the chat-completions format, in a fixed order so the prompt cache holds. */
export function definitionsOf(tools: AssistantTool[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: jsonSchema(t.schema) },
  }))
}

/** Checks the input against the tool's schema; the parsed input or a message for the model. */
export function parseToolInput(tool: AssistantTool, input: unknown): { ok: true; data: any } | { ok: false; error: string } {
  const parsed = tool.schema.safeParse(input ?? {})
  if (parsed.success) return { ok: true, data: parsed.data }
  return { ok: false, error: 'Грешни параметри: ' + clip(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), 400) }
}

/**
 * Runs one tool call from the model. The input is checked against the tool's
 * schema first; anything unknown or malformed comes back as an error result.
 */
export async function runToolIn(tools: AssistantTool[], ctx: ToolContext, name: string, input: unknown): Promise<{ text: string; isError: boolean }> {
  const tool = tools.find(t => t.name === name)
  if (!tool) return { text: toolJson({ error: `Няма инструмент ${name}.` }), isError: true }
  const parsed = parseToolInput(tool, input)
  if (!parsed.ok) return { text: toolJson({ error: parsed.error }), isError: true }
  try {
    const out = await tool.run(ctx, parsed.data)
    const isError = !!out && typeof out === 'object' && 'error' in (out as any) && Object.keys(out as any).length === 1
    return { text: toolJson(out), isError }
  } catch (err) {
    return { text: toolJson(fail(err)), isError: true }
  }
}

export function statusIn(tools: AssistantTool[], name: string): string {
  return tools.find(t => t.name === name)?.status ?? 'Проверявам…'
}
