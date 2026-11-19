import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sofiaToday } from '@/lib/date-utils'
import { summarizeSales, summarizeVoided, previousPeriod } from '@/lib/reports/sales-summary'
import { loadSales, loadVoided, loadLowStock } from '@/lib/reports/load'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const supabase = await createServerSupabaseClient()
  // Sales figures are for admins (Владимир, 2026-11-12). RLS limited the rows
  // already; now the route says so itself.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  // The period asked for and the one of the same length right before it, for
  // the "спрямо предходния период" figures.
  const prev = previousPeriod(sinceDate, untilDate)
  const [current, before, voidedRows] = await Promise.all([
    loadSales(supabase, sinceDate, untilDate),
    loadSales(supabase, prev.from, prev.to),
    loadVoided(supabase, sinceDate, untilDate),
  ])
  const summary = summarizeSales(current.sales, current.movements, { from: sinceDate, to: untilDate })
  const previousSummary = summarizeSales(before.sales, before.movements)
  const voided = summarizeVoided(voidedRows)

  const productQty = new Map<string, number>()
  const productRev = new Map<string, number>()
  for (const s of current.sales) {
    const rev = s.quantity * Number(s.sale_price)
    productQty.set(s.product_name, (productQty.get(s.product_name) || 0) + s.quantity)
    productRev.set(s.product_name, (productRev.get(s.product_name) || 0) + rev)
  }

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

  const lowStockWithStores = await loadLowStock(supabase)

  return NextResponse.json({
    totalRevenue: summary.totals.revenue,
    // Receipts, not sales rows: a receipt with three products is one sale.
    totalCount: summary.totals.receipts,
    uniqueProducts: summary.uniqueProducts,
    byDay: summary.byDay,
    summary,
    voided,
    previous: { from: prev.from, to: prev.to, totals: previousSummary.totals, payment: previousSummary.payment },
    topProducts,
    topRevenue,
    lowStock: lowStockWithStores,
  })
}
