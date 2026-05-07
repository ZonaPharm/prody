import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '7')
  const supabase = await createServerSupabaseClient()

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceDate = since.toISOString().split('T')[0]

  // Get non-warehouse stores
  const { data: stores } = await supabase.from('stores')
    .select('id, name')
    .eq('is_active', true)
    .eq('is_warehouse', false)
    .order('name')

  const { data: sales } = await supabase.from('sales')
    .select('quantity, sale_price, store_id, sale_date')
    .gte('sale_date', sinceDate)

  // Build store sales map
  const storeSalesMap: Record<string, Record<string, number>> = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    storeSalesMap[d] = {}
    ;(stores || []).forEach(s => { storeSalesMap[d][s.id] = 0 })
  }

  ;(sales || []).forEach((s: any) => {
    if (storeSalesMap[s.sale_date]) {
      storeSalesMap[s.sale_date][s.store_id] = (storeSalesMap[s.sale_date][s.store_id] || 0) + s.quantity * Number(s.sale_price)
    }
  })

  const chartData = Object.entries(storeSalesMap).map(([date, amounts]) => ({
    date: new Date(date).toLocaleDateString('bg-BG', { weekday: 'short', day: 'numeric' }),
    ...Object.fromEntries(
      (stores || []).map((store: any) => [store.name, Math.round((amounts[store.id] || 0) * 100) / 100])
    ),
  }))

  return NextResponse.json(chartData)
}
