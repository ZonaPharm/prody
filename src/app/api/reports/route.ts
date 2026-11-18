import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sofiaToday } from '@/lib/date-utils'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { summarizeSales, previousPeriod, type SaleRow, type SellMovement } from '@/lib/reports/sales-summary'

/**
 * The period's sales (voided left out) with store, product and catalogue cost,
 * and the 'sell' stock movements of those sales, which carry the purchase
 * price of the batch each unit came from.
 */
async function loadSales(supabase: any, from: string, to: string): Promise<{ sales: SaleRow[]; movements: SellMovement[] }> {
  const [rows, movements] = await Promise.all([
    fetchAll<any>(() => supabase
      .from('sales')
      .select('id, sale_group_id, store_id, product_id, quantity, sale_price, payment_method, sale_date, store:stores(name), product:products(name, cost_price)')
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
  const one = (v: any) => (Array.isArray(v) ? v[0] : v)
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
  }))
  return {
    sales,
    movements: movements.filter((m: any) => m.sale_id).map((m: any) => ({ sale_id: m.sale_id, quantity: m.quantity, unit_cost: m.unit_cost })),
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const supabase = await createServerSupabaseClient()
  // Sales figures are for admins (Владимир, 2026-11-12). RLS limited the rows
  // already; now the route says so itself.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  let sinceDate: string
  if (from) {
    sinceDate = from
  } else {
    const since = new Date()
    since.setDate(since.getDate() - 30)
    sinceDate = since.toISOString().split('T')[0]
  }
  const untilDate = to || sofiaToday()

  // The period asked for and the one of the same length right before it, for
  // the "спрямо предходния период" figures.
  const prev = previousPeriod(sinceDate, untilDate)
  const [current, before] = await Promise.all([
    loadSales(supabase, sinceDate, untilDate),
    loadSales(supabase, prev.from, prev.to),
  ])
  const summary = summarizeSales(current.sales, current.movements)
  const previousSummary = summarizeSales(before.sales, before.movements)

  const productQty = new Map<string, number>()
  const productRev = new Map<string, number>()
  for (const s of current.sales) {
    const rev = s.quantity * Number(s.sale_price)
    productQty.set(s.product_name, (productQty.get(s.product_name) || 0) + s.quantity)
    productRev.set(s.product_name, (productRev.get(s.product_name) || 0) + rev)
  }

  // Top products by quantity
  const topProducts = Array.from(productQty.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  // Top products by revenue
  const topRevenue = Array.from(productRev.entries())
    .map(([name, revenue]) => ({ name, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 7)

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

  type LowStockRow = { id: string; name: string; quantity_on_hand: number }
  const products: LowStockRow[] = activeProducts
    .map(p => ({ id: p.id, name: p.name, quantity_on_hand: onHandByProduct[p.id] || 0 }))
    .filter(p => p.quantity_on_hand <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.quantity_on_hand - b.quantity_on_hand || a.name.localeCompare(b.name, 'bg'))

  // Fetch per-store quantities for low-stock products
  const lowStockWithStores: (LowStockRow & { stores: { name: string; qty: number }[] })[] = products.map(p => ({ ...p, stores: [] }))
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

  return NextResponse.json({
    totalRevenue: summary.totals.revenue,
    // Receipts, not sales rows: a receipt with three products is one sale.
    totalCount: summary.totals.receipts,
    uniqueProducts: summary.uniqueProducts,
    byDay: summary.byDay,
    summary,
    previous: { from: prev.from, to: prev.to, totals: previousSummary.totals, payment: previousSummary.payment },
    topProducts,
    topRevenue,
    lowStock: lowStockWithStores,
  })
}
