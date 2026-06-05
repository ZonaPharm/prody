import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sofiaToday, sofiaDate } from '@/lib/date-utils'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || sofiaToday()
  const to = searchParams.get('to') || sofiaToday()
  const store = searchParams.get('store')
  const storeIds = store ? store.split(',').filter(Boolean) : []
  const product = searchParams.get('product')
  const category = searchParams.get('category')

  let query = (supabase.from('sales') as any)
    .select('quantity, sale_price, sale_date, sale_group_id, payment_method, product:products(name, category_id), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
    .gte('sale_date', from)
    .lte('sale_date', to)
    .eq('voided', false)
    .order('created_at', { ascending: false })

  if (storeIds.length > 0) query = query.in('store_id', storeIds)
  if (product) query = query.eq('product_id', product)
  if (category) query = query.eq('product.category_id', category)

  const { data: sales } = await query

  // Compute true group counts (2+ items sharing same sale_group_id)
  const groupCounts: Record<string, number> = {}
  ;(sales || []).forEach((s: any) => {
    if (s.sale_group_id) groupCounts[s.sale_group_id] = (groupCounts[s.sale_group_id] || 0) + 1
  })

  // Build CSV with BOM for Excel Bulgarian charset
  const BOM = '﻿'
  const header = 'Продукт;Количество;Ед. цена (€);Сума (€);Продавач;Дата;Плащане;Група\n'
  const rows = (sales || []).map((s: any) => {
    const prod = Array.isArray(s.product) ? s.product[0] : s.product
    const name = prod?.name || '—'
    const seller = Array.isArray(s.seller) ? (s.seller[0]?.display_name || '—') : (s.seller?.display_name || '—')
    const unitPrice = Number(s.sale_price).toFixed(2)
    const total = (s.quantity * Number(s.sale_price)).toFixed(2)
    const date = sofiaDate(s.sale_date)
    const payment = s.payment_method === 'card' ? 'Карта' : s.payment_method === 'transfer' ? 'Превод' : 'Кеш'
    const isGroup = s.sale_group_id && groupCounts[s.sale_group_id] > 1
    const group = isGroup ? 'Да' : 'Не'
    return [
      `"${name.replace(/"/g, '""')}"`,
      s.quantity,
      unitPrice,
      total,
      `"${seller.replace(/"/g, '""')}"`,
      date,
      payment,
      group,
    ].join(';')
  }).join('\n')

  const csv = BOM + header + rows

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sales-${from}-${to}.csv"`,
    },
  })
}
