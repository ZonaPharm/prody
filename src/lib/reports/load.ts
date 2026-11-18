/**
 * Reads for the admin reports, shared by Отчети (/api/reports) and the weekly
 * e-mail (/api/cron/weekly-report). Each takes the Supabase client to read
 * with: the signed-in admin's for the page, the service client for the cron.
 */
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { summarizeSales, type SaleRow, type SellMovement, type VoidedRow } from './sales-summary'

const one = (v: any) => (Array.isArray(v) ? v[0] : v)

/**
 * The period's sales (voided left out) with store, product and catalogue cost,
 * and the 'sell' stock movements of those sales, which carry the purchase
 * price of the batch each unit came from.
 */
export async function loadSales(supabase: any, from: string, to: string): Promise<{ sales: SaleRow[]; movements: SellMovement[] }> {
  const [rows, movements] = await Promise.all([
    fetchAll<any>(() => supabase
      .from('sales')
      .select('id, sale_group_id, store_id, product_id, quantity, sale_price, payment_method, sale_date, created_at, sold_by, store:stores(name), product:products(name, cost_price), seller:users!sales_sold_by_fkey(display_name)')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .eq('voided', false)
      .order('id')),
    // Filtered through the sale itself, so no long list of ids goes in the URL.
    fetchAll<any>(() => supabase
      .from('stock_movements')
      .select('sale_id, quantity, unit_cost, sale:sales!inner(sale_date)')
      .eq('type', 'sell')
      .gte('sale.sale_date', from)
      .lte('sale.sale_date', to)
      .order('id')),
  ])
  const sales: SaleRow[] = rows.map((r: any) => ({
    id: r.id,
    sale_group_id: r.sale_group_id,
    store_id: r.store_id,
    store_name: one(r.store)?.name || '—',
    product_id: r.product_id,
    product_name: one(r.product)?.name || '—',
    quantity: r.quantity,
    sale_price: r.sale_price,
    payment_method: r.payment_method,
    sale_date: r.sale_date,
    cost_price: one(r.product)?.cost_price ?? null,
    sold_by: r.sold_by,
    seller_name: one(r.seller)?.display_name ?? null,
    created_at: r.created_at,
  }))
  return {
    sales,
    movements: movements.filter((m: any) => m.sale_id).map((m: any) => ({ sale_id: m.sale_id, quantity: m.quantity, unit_cost: m.unit_cost })),
  }
}

/** Sales rows voided among the period's sales, with who sold them. */
export async function loadVoided(supabase: any, from: string, to: string): Promise<VoidedRow[]> {
  const rows = await fetchAll<any>(() => supabase
    .from('sales')
    .select('quantity, sale_price, sold_by, seller:users!sales_sold_by_fkey(display_name)')
    .gte('sale_date', from)
    .lte('sale_date', to)
    .eq('voided', true)
    .order('id'))
  return rows.map((r: any) => ({
    quantity: r.quantity,
    sale_price: r.sale_price,
    sold_by: r.sold_by,
    seller_name: one(r.seller)?.display_name ?? null,
  }))
}

export type LowStockRow = { id: string; name: string; quantity_on_hand: number; stores: { name: string; qty: number }[] }

/**
 * Active products with 5 or fewer units in all places together, counted from
 * the batches, with how many each place has.
 */
export async function loadLowStock(supabase: any): Promise<LowStockRow[]> {
  // Low stock — measured from the batches, with a per-store breakdown.
  //
  // products.quantity_on_hand disagrees with the sum of a product's batches
  // for around 150 products, and a physical count settled that the batches
  // are the accurate side. Filtering on quantity_on_hand therefore hides
  // products that are genuinely at or below the threshold — 32 of them at
  // the time of writing.
  const LOW_STOCK_THRESHOLD = 5

  const activeProducts = await fetchAll<{ id: string; name: string }>(() => supabase
    .from('products')
    .select('id, name')
    .eq('status', 'active')
    .order('name')
    .order('id') as any)

  const stockRows = await fetchByIds<{ product_id: string; quantity_remaining: number }>(
    ids => supabase
      .from('stock_batches')
      .select('product_id, quantity_remaining')
      .in('product_id', ids)
      .gt('quantity_remaining', 0) as any,
    activeProducts.map(p => p.id),
  )

  const onHandByProduct: Record<string, number> = {}
  for (const row of stockRows) {
    onHandByProduct[row.product_id] = (onHandByProduct[row.product_id] || 0) + row.quantity_remaining
  }

  type Total = { id: string; name: string; quantity_on_hand: number }
  const products: Total[] = activeProducts
    .map(p => ({ id: p.id, name: p.name, quantity_on_hand: onHandByProduct[p.id] || 0 }))
    .filter(p => p.quantity_on_hand <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand || a.name.localeCompare(b.name, 'bg'))

  // Fetch per-store quantities for low-stock products
  const lowStockWithStores: LowStockRow[] = products.map(p => ({ ...p, stores: [] }))
  if (products.length > 0) {
    const lowIds = products.map(p => p.id)
    const batches = await fetchByIds<any>(
      ids => supabase
        .from('stock_batches')
        .select('product_id, quantity_remaining, store:stores!inner(name)')
        .in('product_id', ids)
        .gt('quantity_remaining', 0) as any,
      lowIds,
    )
    const byProduct: Record<string, { name: string; qty: number }[]> = {}
    ;((batches || []) as any[]).forEach((b: any) => {
      const storeName = Array.isArray(b.store) ? b.store[0]?.name : b.store?.name
      if (!storeName) return
      if (!byProduct[b.product_id]) byProduct[b.product_id] = []
      const existing = byProduct[b.product_id].find(s => s.name === storeName)
      if (existing) existing.qty += b.quantity_remaining
      else byProduct[b.product_id].push({ name: storeName, qty: b.quantity_remaining })
    })
    lowStockWithStores.forEach(p => {
      p.stores = byProduct[p.id] || []
    })
  }

  return lowStockWithStores
}

/**
 * The numbers in the report e-mail (the weekly one and „Изпрати сега“ in
 * Настройки): receipts, not rows, and low stock from the batches, the same
 * figures as Отчети.
 */
export async function loadEmailReportData(supabase: any, from: string, to: string) {
  const [{ sales, movements }, lowStock] = await Promise.all([
    loadSales(supabase, from, to),
    loadLowStock(supabase),
  ])
  const summary = summarizeSales(sales, movements)

  const productQty = new Map<string, number>()
  for (const s of sales) productQty.set(s.product_name, (productQty.get(s.product_name) || 0) + s.quantity)
  const topProducts = Array.from(productQty.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  return {
    totalRevenue: summary.totals.revenue,
    totalCount: summary.totals.receipts,
    uniqueProducts: summary.uniqueProducts,
    topProducts,
    lowStock,
    storeBreakdown: summary.byStore.map(s => ({ store: s.store_name, count: s.receipts, revenue: s.revenue })),
  }
}
