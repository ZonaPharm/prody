import { fetchAll } from '@/lib/fetch-all'

/**
 * What a store may ask Офис for in "Заявки": only what Офис can send now.
 *
 * The number comes from public.office_free_stock() (migration
 * 20261112_deliveries_office_stock.sql), the same count that "Добави от Офис"
 * checks: Офис stock minus what open deliveries keep for stores or still wait
 * for a label, minus Офис stock already packed for a trip. Before that
 * migration runs (production today, where there are no deliveries yet) the
 * count is simply the stock in Офис.
 *
 * Read with the service-role client only (the function is for service_role).
 */

type Admin = any

export type OfficeStock = {
  product_id: string
  /** In Офис now (stock batches of the warehouse). */
  on_hand: number
  /** Kept for stores by open deliveries, or waiting for a label. */
  for_deliveries: number
  /** Офис stock already in a shipment that has not left. */
  in_shipments: number
  /** What a store can ask for. */
  free: number
}

export type OfficeStockMap = Record<string, OfficeStock>

const MISSING_FUNCTION = new Set(['PGRST202', '42883'])

function isMissingFunction(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && MISSING_FUNCTION.has(code)
}

function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Rows of office_free_stock() by product; free never below 0. */
export function toOfficeStockMap(rows: Partial<OfficeStock>[]): OfficeStockMap {
  const out: OfficeStockMap = {}
  for (const r of rows) {
    if (!r.product_id) continue
    const on_hand = n(r.on_hand)
    const for_deliveries = n(r.for_deliveries)
    const in_shipments = n(r.in_shipments)
    const free = r.free == null ? on_hand - for_deliveries - in_shipments : n(r.free)
    out[r.product_id] = { product_id: r.product_id, on_hand, for_deliveries, in_shipments, free: Math.max(0, free) }
  }
  return out
}

/** Stock in Офис by product, from the warehouse batches (no deliveries yet). */
export function batchesToOfficeStock(batches: { product_id: string; quantity_remaining: number }[]): OfficeStockMap {
  const sum: Record<string, number> = {}
  for (const b of batches) {
    if (!b.product_id || !(b.quantity_remaining > 0)) continue
    sum[b.product_id] = (sum[b.product_id] ?? 0) + b.quantity_remaining
  }
  return toOfficeStockMap(Object.entries(sum).map(([product_id, on_hand]) => ({
    product_id, on_hand, for_deliveries: 0, in_shipments: 0, free: on_hand,
  })))
}

/** How many of this product a store can ask for (0 when Офис has none free). */
export function freeInOffice(stock: OfficeStockMap, productId: string): number {
  return stock[productId]?.free ?? 0
}

export type NotRequestable = 'none' | 'packed' | 'kept'

/** What the seller reads for each reason. */
export const NOT_REQUESTABLE_TEXT: Record<NotRequestable, string> = {
  none: 'Няма го в Офис',
  packed: 'Каквото има в Офис, вече е в пратка за магазин',
  kept: 'В Офис е, но е за магазините по доставка или още чака етикет',
}

/** Why a product cannot be asked for; null when it can. */
export function notRequestable(s: OfficeStock | undefined): NotRequestable | null {
  if (s && s.free > 0) return null
  if (!s || s.on_hand <= 0) return 'none'
  if (s.in_shipments > 0 && s.for_deliveries <= 0) return 'packed'
  return 'kept'
}

/** The same, in the words the seller sees. */
export function notRequestableReason(s: OfficeStock | undefined): string | null {
  const why = notRequestable(s)
  return why ? NOT_REQUESTABLE_TEXT[why] : null
}

export type RequestItem = { product_id: string; quantity: number }

/**
 * The first item a store may not ask for, as a message; null when all are fine.
 * Each product may be asked for up to what Офис has free (the same product twice
 * counts together).
 */
export function checkRequestItems(
  items: RequestItem[],
  stock: OfficeStockMap,
  names: Record<string, string>,
): string | null {
  const want: Record<string, number> = {}
  for (const i of items) want[i.product_id] = (want[i.product_id] ?? 0) + i.quantity
  for (const [id, qty] of Object.entries(want)) {
    const name = names[id] ?? 'Продуктът'
    const free = freeInOffice(stock, id)
    if (free <= 0) {
      const why = notRequestableReason(stock[id]) ?? 'Няма го в Офис'
      return `„${name}“ не може да се заяви: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`
    }
    if (qty > free) return `„${name}“: в Офис може да се заявят най-много ${free} бр.`
  }
  return null
}

async function warehouseBatches(admin: Admin, productIds: string[] | null): Promise<OfficeStockMap> {
  const { data: stores, error } = await admin.from('stores').select('id').eq('is_warehouse', true)
  if (error) throw error
  const ids = (stores ?? []).map((s: any) => s.id)
  if (ids.length === 0) return {}
  const rows = await fetchAll<any>(() => {
    let q = admin.from('stock_batches').select('id, product_id, quantity_remaining')
      .in('store_id', ids).gt('quantity_remaining', 0)
    if (productIds) q = q.in('product_id', productIds)
    return q.order('id')
  })
  return batchesToOfficeStock(rows)
}

/**
 * Free Офис stock: for the given products (a short list, e.g. one request) or
 * for everything Офис holds (null).
 */
export async function getOfficeStock(admin: Admin, productIds: string[] | null = null): Promise<OfficeStockMap> {
  if (productIds && productIds.length === 0) return {}
  try {
    const rows = await fetchAll<any>(() =>
      admin.rpc('office_free_stock', { p_product_ids: productIds }).order('product_id'),
    )
    return toOfficeStockMap(rows)
  } catch (e) {
    if (!isMissingFunction(e)) throw e
    // Migration not run here yet: no deliveries, so Офис stock is all free.
    return warehouseBatches(admin, productIds)
  }
}

/**
 * For the request routes: why these items cannot be asked for, or null. Reads
 * Офис stock and the product names for just these products. Throws when the
 * read fails (the caller answers "try again", never lets the request through).
 */
export async function requestProblem(admin: Admin, items: RequestItem[]): Promise<string | null> {
  const ids = [...new Set(items.map(i => i.product_id))]
  if (ids.length === 0) return null
  const [stock, { data: prods, error }] = await Promise.all([
    getOfficeStock(admin, ids),
    admin.from('products').select('id, name').in('id', ids),
  ])
  if (error) throw error
  const names = Object.fromEntries((prods ?? []).map((p: any) => [p.id, p.name]))
  return checkRequestItems(items, stock, names)
}
