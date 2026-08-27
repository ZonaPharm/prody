import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWeeklyReport } from '@/lib/email'
import { sofiaToday } from '@/lib/date-utils'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  if (secret !== process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()

  if (!settings || !settings.smtp_host || !settings.smtp_user) {
    return NextResponse.json({ error: 'SMTP not configured' }, { status: 400 })
  }

  const now = new Date()
  if (now.getDay() !== settings.report_day) {
    return NextResponse.json({ skipped: true, reason: 'wrong_day' })
  }
  if (now.getHours() !== settings.report_hour) {
    return NextResponse.json({ skipped: true, reason: 'wrong_hour' })
  }

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const today = sofiaToday()

  const sales = await fetchAll<any>(() => (admin.from('sales') as any)
    .select('quantity, sale_price, product:products(name)')
    .gte('sale_date', weekAgo).lte('sale_date', today).eq('voided', false)
    .order('id'))

  const productQty = new Map<string, number>()
  let totalRevenue = 0, totalCount = 0
  const productSet = new Set<string>()
  ;(sales || []).forEach((s: any) => {
    const name = Array.isArray(s.product) ? s.product[0]?.name : s.product?.name || '—'
    productQty.set(name, (productQty.get(name) || 0) + s.quantity)
    totalRevenue += s.quantity * Number(s.sale_price)
    totalCount++; productSet.add(name)
  })

  const topProducts = Array.from(productQty.entries()).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 10)
  const lowStock = await fetchAll<any>(() => (admin.from('products') as any).select('name, quantity_on_hand').eq('status', 'active').lte('quantity_on_hand', 5).order('quantity_on_hand').order('id'))

  const storeSales = await fetchAll<any>(() => (admin.from('sales') as any).select('quantity, sale_price, store:stores(name)').gte('sale_date', weekAgo).lte('sale_date', today).eq('voided', false).order('id'))
  const storeMap: Record<string, { count: number; revenue: number }> = {}
  ;(storeSales || []).forEach((s: any) => {
    const store = Array.isArray(s.store) ? s.store[0]?.name : s.store?.name || '—'
    if (!storeMap[store]) storeMap[store] = { count: 0, revenue: 0 }
    storeMap[store].count++; storeMap[store].revenue += s.quantity * Number(s.sale_price)
  })
  const storeBreakdown = Object.entries(storeMap).map(([store, v]) => ({ store, count: v.count, revenue: Math.round(v.revenue * 100) / 100 }))

  const fetchSalesForExport = async (q: { from: string; to: string; store_id?: string | null }) => {
    const data = await fetchAll<any>(() => {
      let query = (admin.from('sales') as any)
        .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
        .gte('sale_date', q.from).lte('sale_date', q.to).eq('voided', false).order('sale_date', { ascending: false }).order('id')
      if (q.store_id) query = query.eq('store_id', q.store_id)
      return query
    })
    const productIds = [...new Set((data || []).map((s: any) => s.product_id))]
    const prods = await fetchByIds<any>(ids => (admin.from('products') as any).select('id, category:categories(name)').in('id', ids), productIds as string[])
    const catMap: Record<string, string> = {}
    ;(prods || []).forEach((p: any) => { const cn = Array.isArray(p.category) ? p.category[0]?.name : p.category?.name; if (cn) catMap[p.id] = cn })
    return (data || []).map((s: any) => ({
      quantity: s.quantity, sale_price: s.sale_price, sale_date: s.sale_date, payment_method: s.payment_method,
      product_name: Array.isArray(s.product) ? s.product[0]?.name : s.product?.name,
      store_name: Array.isArray(s.store) ? s.store[0]?.name : s.store?.name,
      category_name: catMap[s.product_id] || '—',
      seller_name: Array.isArray(s.seller) ? s.seller[0]?.display_name : s.seller?.display_name,
    }))
  }

  const parsed = { ...settings, recipients: (settings.recipients || []) as string[] }
  await sendWeeklyReport(parsed, { totalRevenue: Math.round(totalRevenue * 100) / 100, totalCount, uniqueProducts: productSet.size, topProducts, lowStock: lowStock || [], storeBreakdown }, fetchSalesForExport)
  return NextResponse.json({ sent: true, recipients: parsed.recipients.length })
}
