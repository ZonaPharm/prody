import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || new Date().toISOString().split('T')[0]
  const to = searchParams.get('to') || new Date().toISOString().split('T')[0]

  const { data: sales } = await (supabase.from('sales') as any)
    .select('quantity, sale_price, sale_date, sale_group_id, product:products(name), store:stores(name), seller:users(display_name)')
    .gte('sale_date', from)
    .lte('sale_date', to)
    .eq('voided', false)
    .order('created_at', { ascending: false })

  // Build CSV with BOM for Excel Bulgarian charset
  const BOM = '﻿'
  const header = 'Продукт;Количество;Цена (€);Сума (€);Обект;Продавач;Дата;Плащане;Група\n'
  const rows = (sales || []).map((s: any) => {
    const name = Array.isArray(s.product) ? (s.product[0]?.name || '—') : (s.product?.name || '—')
    const store = Array.isArray(s.store) ? (s.store[0]?.name || '—') : (s.store?.name || '—')
    const seller = Array.isArray(s.seller) ? (s.seller[0]?.display_name || '—') : (s.seller?.display_name || '—')
    const total = (s.quantity * Number(s.sale_price)).toFixed(2)
    const date = new Date(s.sale_date).toLocaleDateString('bg-BG')
    const payment = s.payment_method === 'card' ? 'Карта' : 'Кеш'
    const group = s.sale_group_id ? 'Да' : 'Не'
    return [
      `"${name.replace(/"/g, '""')}"`,
      s.quantity,
      Number(s.sale_price).toFixed(2),
      total,
      `"${store.replace(/"/g, '""')}"`,
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
