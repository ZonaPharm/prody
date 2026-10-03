import { fetchAll } from '@/lib/fetch-all'

/**
 * Stock per product across all stores, summed from stock_batches — what the
 * stores actually hold. products.quantity_on_hand is a separate counter that
 * drifts from the batches, so screens should show this instead.
 *
 * Reads every batch with stock in pages: there are well over 1000 of them and
 * PostgREST would otherwise return a silently truncated slice.
 */
export async function getStockTotals(client: any): Promise<Record<string, number>> {
  const rows = await fetchAll<{ product_id: string; quantity_remaining: number }>(() =>
    client
      .from('stock_batches')
      .select('product_id, quantity_remaining')
      .gt('quantity_remaining', 0)
      .order('id'),
  )
  const totals: Record<string, number> = {}
  for (const r of rows) {
    totals[r.product_id] = (totals[r.product_id] || 0) + r.quantity_remaining
  }
  return totals
}
