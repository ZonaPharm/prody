// How a store's stock is shown on a catalog card: each store in its own box,
// so the name and its count are read together and never with the neighbour's.

export type StoreStockTone = 'empty' | 'low' | 'ok'

/** 0 = none left (red), at or below the product's minimum = low (amber), else ok. */
export function storeStockTone(qty: number, minQuantity?: number | null): StoreStockTone {
  if (qty <= 0) return 'empty'
  if (minQuantity && qty <= minQuantity) return 'low'
  return 'ok'
}

/** Box, store name and count colours for each tone. Kept here so Tailwind sees the full class names. */
export const STORE_STOCK_TONE: Record<StoreStockTone, { box: string; name: string; qty: string }> = {
  empty: { box: 'border-red-200 bg-red-50', name: 'text-red-700', qty: 'text-red-700' },
  low: { box: 'border-amber-300 bg-amber-50', name: 'text-amber-800', qty: 'text-amber-800' },
  ok: { box: 'border-slate-200 bg-slate-50', name: 'text-slate-600', qty: 'text-slate-900' },
}
