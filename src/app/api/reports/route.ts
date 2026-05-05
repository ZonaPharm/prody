import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '30')
  const supabase = await createServerSupabaseClient()
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceDate = since.toISOString().split('T')[0]

  // Top products by quantity sold
  const { data: topProducts } = await supabase
    .from('sales')
    .select('product:products(name), quantity')
    .gte('sale_date', sinceDate)

  // Aggregate quantities per product
  const aggregated = new Map<string, { name: string; quantity: number }>()
  ;(topProducts || []).forEach((s: any) => {
    const key = s.product?.name || 'Unknown'
    const existing = aggregated.get(key)
    if (existing) existing.quantity += s.quantity
    else aggregated.set(key, { name: key, quantity: s.quantity })
  })
  const topList = Array.from(aggregated.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)

  // Sales by day
  const { data: byDay } = await supabase
    .from('sales')
    .select('sale_date, quantity')
    .gte('sale_date', sinceDate)
    .order('sale_date')

  const dayAggregated = new Map<string, number>()
  ;(byDay || []).forEach((s: any) => {
    dayAggregated.set(s.sale_date, (dayAggregated.get(s.sale_date) || 0) + s.quantity)
  })
  const dayList = Array.from(dayAggregated.entries())
    .map(([sale_date, count]) => ({ sale_date, count }))
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date))

  // Low stock
  const { data: lowStock } = await supabase
    .from('products')
    .select('id, name, quantity_on_hand')
    .eq('status', 'listed')
    .lte('quantity_on_hand', 5)
    .order('quantity_on_hand')

  return NextResponse.json({
    topProducts: topList,
    byDay: dayList,
    lowStock: lowStock || [],
  })
}
