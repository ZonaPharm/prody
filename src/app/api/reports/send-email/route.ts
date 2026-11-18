import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWeeklyReport } from '@/lib/email'
import { sofiaToday } from '@/lib/date-utils'
import { fetchAll } from '@/lib/fetch-all'
import { loadEmailReportData } from '@/lib/reports/load'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()
  if (!settings || !settings.smtp_host) return NextResponse.json({ error: 'SMTP not configured' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const weekAgo = body.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const today = body.to || sofiaToday()

  // Same figures as the weekly e-mail and Отчети: receipts, stores, low stock.
  const reportData = await loadEmailReportData(admin, weekAgo, today)

  const fetchSalesForExport = async (q: { from: string; to: string; store_id?: string | null }) => {
    const data = await fetchAll<any>(() => (admin.from('sales') as any)
      .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
      .gte('sale_date', q.from).lte('sale_date', q.to).eq('voided', false).order('sale_date', { ascending: false }).order('id'))
    return (data || []).map((s: any) => ({
      quantity: s.quantity, sale_price: s.sale_price, sale_date: s.sale_date, payment_method: s.payment_method,
      product_name: Array.isArray(s.product) ? s.product[0]?.name : s.product?.name,
      store_name: Array.isArray(s.store) ? s.store[0]?.name : s.store?.name,
      category_name: '—', seller_name: Array.isArray(s.seller) ? s.seller[0]?.display_name : s.seller?.display_name,
    }))
  }

  // Override recipients for test if test_email provided
  const recipients = body.test_email ? [body.test_email] : (settings.recipients || [])
  const parsed = { ...settings, recipients: recipients as string[] }

  try {
    await sendWeeklyReport(parsed, reportData, fetchSalesForExport)
    return NextResponse.json({ sent: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
