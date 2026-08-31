import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sofiaToday } from '@/lib/date-utils'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const supabase = await createServerSupabaseClient()
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

  // All sales for the period
  const sales = await fetchAll<any>(() => supabase
    .from('sales')
    .select('quantity, sale_price, sale_date, product:products(name)')
    .gte('sale_date', sinceDate)
    .lte('sale_date', untilDate)
    .eq('voided', false)
    .order('sale_date') as any)

  // Aggregate: revenue by day
  const dayMap = new Map<string, number>()
  const productQty = new Map<string, number>()
  const productRev = new Map<string, number>()
  let totalRevenue = 0
  let totalCount = 0
  const productSet = new Set<string>()

  ;(sales || []).forEach((s: any) => {
    const name = Array.isArray(s.product) ? (s.product[0]?.name || '—') : (s.product?.name || '—')
    const rev = s.quantity * Number(s.sale_price)

    dayMap.set(s.sale_date, (dayMap.get(s.sale_date) || 0) + rev)
    productQty.set(name, (productQty.get(name) || 0) + s.quantity)
    productRev.set(name, (productRev.get(name) || 0) + rev)
    productSet.add(name)
    totalRevenue += rev
    totalCount++
  })

  // Revenue by day (sorted)
  const byDay = Array.from(dayMap.entries())
    .map(([sale_date, revenue]) => ({ sale_date, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date))

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
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCount,
    uniqueProducts: productSet.size,
    byDay,
    topProducts,
    topRevenue,
    lowStock: lowStockWithStores,
  })
}
