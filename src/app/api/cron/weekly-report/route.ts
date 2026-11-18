import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWeeklyReport } from '@/lib/email'
import { sofiaToday } from '@/lib/date-utils'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { loadEmailReportData } from '@/lib/reports/load'

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

  const reportData = await loadEmailReportData(admin, weekAgo, today)

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
  await sendWeeklyReport(parsed, reportData, fetchSalesForExport)
  return NextResponse.json({ sent: true, recipients: parsed.recipients.length })
}
