import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWeeklyReport } from '@/lib/email'

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
  const today = body.to || new Date().toISOString().split('T')[0]

  const { data: sales } = await (admin.from('sales') as any)
    .select('quantity, sale_price, product:products(name)')
    .gte('sale_date', weekAgo).lte('sale_date', today).eq('voided', false)

  const productQty = new Map<string, number>()
  let totalRevenue = 0, totalCount = 0
  const productSet = new Set<string>()
  ;(sales || []).forEach((s: any) => {
    const name = Array.isArray(s.product) ? s.product[0]?.name : s.product?.name || '—'
    productQty.set(name, (productQty.get(name) || 0) + s.quantity)
    totalRevenue += s.quantity * Number(s.sale_price)
    totalCount++; productSet.add(name)
  })

  const reportData = {
    totalRevenue: Math.round(totalRevenue * 100) / 100, totalCount, uniqueProducts: productSet.size,
    topProducts: Array.from(productQty.entries()).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    lowStock: [] as any[], storeBreakdown: [] as any[],
  }

  const fetchSalesForExport = async (q: { from: string; to: string; store_id?: string | null }) => {
    let query = (admin.from('sales') as any)
      .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
      .gte('sale_date', q.from).lte('sale_date', q.to).eq('voided', false).order('sale_date', { ascending: false })
    const { data } = await query
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
