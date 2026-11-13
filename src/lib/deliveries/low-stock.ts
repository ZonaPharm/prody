/**
 * Low stock in the stores, so Офис can send goods before a store runs out and
 * asks for them (Владимир, 2026-11-12).
 *
 * A store × product is "low" when
 *  - the store has sold it in the last SALES_DAYS days, and
 *  - it is at or under the product's „Мин. количество“ (products.min_quantity,
 *    5 when empty), or at the current pace it runs out within RUNOUT_DAYS.
 * With mode 'min' every product the store carries counts as soon as it is at or
 * under the minimum, sold or not.
 *
 * For each low row the screen suggests how much to send from Офис: enough to
 * reach the target (twice the minimum, or COVER_DAYS of sales if that is more),
 * less what is already on its way (a packing/packed shipment) or asked for in
 * „Заявки“. When Офис has less than all the stores need, the free quantity goes
 * to the most urgent first: everyone is lifted above the minimum before anyone
 * gets more.
 *
 * Pure functions only; the data comes from low-stock-data.ts.
 */

export const SALES_DAYS = 30
export const RUNOUT_DAYS = 14
export const COVER_DAYS = 28
export const DEFAULT_MIN = 5

export type LowMode = 'selling' | 'min'

export type LowStore = { id: string; name: string; is_warehouse: boolean }
export type LowProduct = { id: string; name: string; sku: string | null; min_quantity: number | null }
/** One row per batch is fine: quantities of the same store × product add up. */
export type StoreQty = { store_id: string; product_id: string; qty: number }

export type LowInput = {
  stores: LowStore[]
  /** Active products only. */
  products: LowProduct[]
  /** stock_batches.quantity_remaining; a 0 row still says the store carries it. */
  stock: StoreQty[]
  /** Units sold in each store in the last SALES_DAYS days (voided sales left out). */
  sold: StoreQty[]
  /** On a shipment from Офис that has not left yet (packing / packed), by destination store. */
  onTrip: StoreQty[]
  /** Open requests from „Заявки“ (pending, accepted, in transit). */
  requested: StoreQty[]
  /**
   * Free in Офис per product from the database (office_free_stock, the same number
   * add_office_stock checks: also less what open deliveries still need). Missing
   * products have 0 free. Without it: Офис stock less what is packed already.
   */
  officeFree?: Record<string, number>
}

export type LowReason = 'out' | 'under_min' | 'runs_out'

export type LowRow = {
  store_id: string
  store_name: string
  product_id: string
  product_name: string
  sku: string | null
  min: number
  qty: number
  sold: number
  /** Days until the store runs out at the pace of the last SALES_DAYS days; null when it does not sell. */
  days_left: number | null
  reason: LowReason
  on_trip: number
  requested: number
  /** What the store should have after the goods arrive. */
  target: number
  /** target − qty − on the way − requested, never below 0. */
  need: number
  /** What Офис can send now (after sharing among the stores). */
  suggest: number
}

export type LowProductGroup = {
  product_id: string
  product_name: string
  sku: string | null
  office: number
  /** Офис stock not already packed for some store. */
  office_free: number
  rows: LowRow[]
  need: number
  suggest: number
  /** Needed but not in Офис: to order from the supplier. */
  short: number
}

export type LowStoreGroup = { store_id: string; store_name: string; rows: LowRow[] }

export type LowResult = {
  rows: LowRow[]
  byProduct: LowProductGroup[]
  byStore: LowStoreGroup[]
  officeFree: Record<string, number>
}

const key = (store: string, product: string) => `${store}|${product}`

function sumBy(rows: StoreQty[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = key(r.store_id, r.product_id)
    m.set(k, (m.get(k) ?? 0) + (Number(r.qty) || 0))
  }
  return m
}

export function minOf(p: Pick<LowProduct, 'min_quantity'>): number {
  const n = p.min_quantity
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? DEFAULT_MIN : Math.max(0, Math.floor(Number(n)))
}

/** Days of stock left at the pace of `sold` units in SALES_DAYS days; null when nothing sold. */
export function daysLeft(qty: number, sold: number): number | null {
  if (sold <= 0) return null
  return Math.floor((Math.max(0, qty) * SALES_DAYS) / sold)
}

export function targetQty(min: number, sold: number): number {
  return Math.max(2 * min, Math.ceil((sold * COVER_DAYS) / SALES_DAYS), 1)
}

export function lowReason(qty: number, min: number, sold: number, mode: LowMode): LowReason | null {
  const d = daysLeft(qty, sold)
  const selling = sold > 0
  if (!selling && mode === 'selling') return null
  if (qty <= 0) return 'out'
  if (qty <= min) return 'under_min'
  if (d !== null && d < RUNOUT_DAYS) return 'runs_out'
  return null
}

/** The most urgent first: out of stock, then fewest days left, then furthest under the minimum. */
export function urgency(a: LowRow, b: LowRow): number {
  const outA = a.qty <= 0 ? 0 : 1
  const outB = b.qty <= 0 ? 0 : 1
  if (outA !== outB) return outA - outB
  const dA = a.days_left ?? Number.POSITIVE_INFINITY
  const dB = b.days_left ?? Number.POSITIVE_INFINITY
  if (dA !== dB) return dA - dB
  const rA = a.min > 0 ? a.qty / a.min : a.qty
  const rB = b.min > 0 ? b.qty / b.min : b.qty
  if (rA !== rB) return rA - rB
  if (a.sold !== b.sold) return b.sold - a.sold
  return a.store_name.localeCompare(b.store_name, 'bg')
}

/**
 * Shares `free` units among rows (one product, several stores), the most urgent
 * first: pass 1 lifts every store just above its minimum, pass 2 fills up to
 * what each needs. Returns the units per row, in the order given.
 */
export function shareOffice(rows: Pick<LowRow, 'qty' | 'min' | 'on_trip' | 'requested' | 'need'>[], free: number): number[] {
  const out = rows.map(() => 0)
  let left = Math.max(0, Math.floor(free))
  // Pass 1: up to min + 1, so the row stops being "under the minimum".
  for (let i = 0; i < rows.length && left > 0; i++) {
    const r = rows[i]
    const have = r.qty + r.on_trip + r.requested
    const give = Math.min(left, r.need, Math.max(0, r.min + 1 - have))
    out[i] += give
    left -= give
  }
  // Pass 2: the rest of what each needs.
  for (let i = 0; i < rows.length && left > 0; i++) {
    const give = Math.min(left, rows[i].need - out[i])
    out[i] += give
    left -= give
  }
  return out
}

export function lowStock(input: LowInput, mode: LowMode = 'selling'): LowResult {
  const stores = new Map(input.stores.map(s => [s.id, s]))
  const warehouses = new Set(input.stores.filter(s => s.is_warehouse).map(s => s.id))
  const products = new Map(input.products.map(p => [p.id, p]))

  const stock = sumBy(input.stock)
  const sold = sumBy(input.sold)
  const onTrip = sumBy(input.onTrip)
  const requested = sumBy(input.requested)

  // Офис: everything in a warehouse store, less what is packed for someone already.
  const office: Record<string, number> = {}
  for (const r of input.stock) {
    if (warehouses.has(r.store_id)) office[r.product_id] = (office[r.product_id] ?? 0) + (Number(r.qty) || 0)
  }
  const packed: Record<string, number> = {}
  for (const r of input.onTrip) packed[r.product_id] = (packed[r.product_id] ?? 0) + (Number(r.qty) || 0)
  const officeFree: Record<string, number> = {}
  if (input.officeFree) {
    for (const [pid, n] of Object.entries(input.officeFree)) officeFree[pid] = Math.max(0, Math.floor(Number(n) || 0))
  } else {
    for (const pid of new Set([...Object.keys(office), ...Object.keys(packed)])) {
      officeFree[pid] = Math.max(0, (office[pid] ?? 0) - (packed[pid] ?? 0))
    }
  }

  // Every store × product the store carries (has a batch) or has sold.
  const pairs = new Set<string>([...stock.keys(), ...sold.keys()])
  const rows: LowRow[] = []
  for (const k of pairs) {
    const [storeId, productId] = k.split('|')
    const store = stores.get(storeId)
    const product = products.get(productId)
    if (!store || store.is_warehouse || !product) continue
    const qty = Math.max(0, stock.get(k) ?? 0)
    const s = sold.get(k) ?? 0
    const min = minOf(product)
    const reason = lowReason(qty, min, s, mode)
    if (!reason) continue
    const target = targetQty(min, s)
    const t = onTrip.get(k) ?? 0
    const q = requested.get(k) ?? 0
    rows.push({
      store_id: storeId, store_name: store.name,
      product_id: productId, product_name: product.name, sku: product.sku,
      min, qty, sold: s, days_left: daysLeft(qty, s), reason,
      on_trip: t, requested: q, target,
      need: Math.max(0, target - qty - t - q),
      suggest: 0,
    })
  }

  // Share Офис per product, the most urgent store first.
  const byProductRows = new Map<string, LowRow[]>()
  for (const r of rows) {
    const list = byProductRows.get(r.product_id) ?? []
    list.push(r)
    byProductRows.set(r.product_id, list)
  }
  const byProduct: LowProductGroup[] = []
  for (const [pid, list] of byProductRows) {
    list.sort(urgency)
    const free = officeFree[pid] ?? 0
    shareOffice(list, free).forEach((n, i) => { list[i].suggest = n })
    const p = products.get(pid)!
    const need = list.reduce((n, r) => n + r.need, 0)
    const suggest = list.reduce((n, r) => n + r.suggest, 0)
    byProduct.push({
      product_id: pid, product_name: p.name, sku: p.sku,
      office: office[pid] ?? 0, office_free: free,
      rows: list, need, suggest, short: need - suggest,
    })
  }
  // What can go now first, then the most urgent store of each product, then by name.
  byProduct.sort((a, b) =>
    (b.suggest > 0 ? 1 : 0) - (a.suggest > 0 ? 1 : 0)
    || urgency(a.rows[0], b.rows[0])
    || a.product_name.localeCompare(b.product_name, 'bg'))

  const storeMap = new Map<string, LowStoreGroup>()
  for (const r of rows) {
    const g = storeMap.get(r.store_id) ?? { store_id: r.store_id, store_name: r.store_name, rows: [] }
    g.rows.push(r)
    storeMap.set(r.store_id, g)
  }
  const byStore = [...storeMap.values()].sort((a, b) => a.store_name.localeCompare(b.store_name, 'bg'))
  for (const g of byStore) g.rows.sort(urgency)

  return { rows: rows.sort(urgency), byProduct, byStore, officeFree }
}

/** Which tab a row belongs to on the screen. */
export type LowTab = 'send' | 'order' | 'coming'

export function rowTab(r: Pick<LowRow, 'need' | 'suggest'>): LowTab {
  if (r.need <= 0) return 'coming'
  return r.suggest > 0 ? 'send' : 'order'
}

/** Short reason under a row. Офис (no sales) gets the words without the pace. */
export function reasonText(r: Pick<LowRow, 'reason' | 'days_left' | 'min'>, opts: { sales: boolean }): string {
  if (r.reason === 'out') return 'Свършил'
  if (r.reason === 'under_min') return `Под минимума (${r.min})`
  if (!opts.sales || r.days_left === null) return 'Свършва скоро'
  return r.days_left <= 0 ? 'Свършва днес' : `Свършва до ~${r.days_left} ${r.days_left === 1 ? 'ден' : 'дни'}`
}

/** Units sold in SALES_DAYS days as a weekly pace, for admins: "~3 бр./седм.". */
export function paceText(sold: number): string {
  if (sold <= 0) return 'Не се продава'
  const perWeek = (sold * 7) / SALES_DAYS
  return perWeek < 1 ? `~${sold} бр./${SALES_DAYS} дни` : `~${Math.round(perWeek)} бр./седм.`
}

/**
 * For Офис without Администратор: the same rows without sales numbers
 * (Офис does not see sales, Владимир 2026-11-12). Days left and units sold are
 * dropped; "fast" says the store sells it quickly.
 */
export function withoutSales<T extends Pick<LowRow, 'sold' | 'days_left'>>(r: T): T & { fast: boolean } {
  const fast = r.days_left !== null && r.days_left < RUNOUT_DAYS
  return { ...r, sold: 0, days_left: null, fast }
}

/** A line for the „Добави от Офис“ request: one store, one product, units. */
export type SendLine = { store_id: string; product_id: string; qty: number }

/** Groups picked lines per store (one request per store), dropping zero and merging repeats. */
export function sendPlan(lines: SendLine[]): { store_id: string; lines: { product_id: string; qty: number }[] }[] {
  const byStore = new Map<string, Map<string, number>>()
  for (const l of lines) {
    const qty = Math.floor(Number(l.qty) || 0)
    if (qty <= 0) continue
    const m = byStore.get(l.store_id) ?? new Map<string, number>()
    m.set(l.product_id, (m.get(l.product_id) ?? 0) + qty)
    byStore.set(l.store_id, m)
  }
  return [...byStore].map(([store_id, m]) => ({ store_id, lines: [...m].map(([product_id, qty]) => ({ product_id, qty })) }))
}

/** Over-picking check: per product the picked units cannot exceed what is free in Офис. */
export function overOffice(lines: SendLine[], officeFree: Record<string, number>): string[] {
  const picked: Record<string, number> = {}
  for (const l of lines) picked[l.product_id] = (picked[l.product_id] ?? 0) + Math.max(0, Math.floor(Number(l.qty) || 0))
  return Object.keys(picked).filter(pid => picked[pid] > (officeFree[pid] ?? 0))
}
