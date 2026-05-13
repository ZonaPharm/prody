import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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
  const untilDate = to || new Date().toISOString().split('T')[0]

  // All sales for the period
  const { data: sales } = await supabase
    .from('sales')
    .select('quantity, sale_price, sale_date, product:products(name)')
    .gte('sale_date', sinceDate)
    .lte('sale_date', untilDate)
    .eq('voided', false)

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

  // Low stock
  const { data: lowStock } = await supabase
    .from('products')
    .select('id, name, quantity_on_hand')
    .eq('status', 'active')
    .lte('quantity_on_hand', 5)
    .order('quantity_on_hand')

  return NextResponse.json({
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCount,
    uniqueProducts: productSet.size,
    byDay,
    topProducts,
    topRevenue,
    lowStock: lowStock || [],
  })
}
