// What each store (and Офис) holds of a product right now, shown under the
// distribution fields while a delivery is entered, so the admin can see who
// needs it before splitting.

/** product_id → store_id → units on hand now. */
export type StoreStockMap = Record<string, Record<string, number>>

/** What the plan editor shows for one product. */
export type CurrentStock = {
  /** store_id → units now (stores with none are missing or 0). */
  byStore: Record<string, number>
  /** Units in Офис now. */
  office: number
  /** The product's minimum (products.min_quantity): at or below it is shown as low. */
  min: number | null
}

export const MAX_STOCK_IDS = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The ids from "?ids=a,b,c": only uuids, each once, at most MAX_STOCK_IDS. */
export function parseProductIds(raw: string | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of (raw ?? '').split(',')) {
    const id = part.trim().toLowerCase()
    if (!UUID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= MAX_STOCK_IDS) break
  }
  return out
}

/** Batches summed per product and store. Every asked product is in the result, also with no stock. */
export function sumStockByStore(
  productIds: string[],
  batches: { product_id: string; store_id: string; quantity_remaining: number | string | null }[],
): StoreStockMap {
  const out: StoreStockMap = Object.fromEntries(productIds.map(id => [id, {}]))
  for (const b of batches) {
    const qty = Number(b.quantity_remaining) || 0
    if (qty <= 0) continue
    const row = (out[b.product_id] ??= {})
    row[b.store_id] = (row[b.store_id] ?? 0) + qty
  }
  return out
}

/** One product's numbers for the plan editor; undefined while they are not loaded. */
export function currentStockOf(
  productId: string,
  stock: StoreStockMap,
  min: Record<string, number | null>,
  warehouseId: string | null | undefined,
): CurrentStock | undefined {
  const byStore = stock[productId]
  if (!byStore) return undefined
  return { byStore, office: warehouseId ? byStore[warehouseId] ?? 0 : 0, min: min[productId] ?? null }
}
