import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Download } from 'lucide-react'
import { VoidSaleButton } from '@/components/sales/void-sale-button'
import { SalesFilters } from './filters'
import { sofiaToday, sofiaTime, sofiaDate } from '@/lib/date-utils'

interface PageProps {
  searchParams: Promise<{ store?: string; from?: string; to?: string; product?: string; category?: string; page?: string; grouped?: string }>
}

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

function buildPageUrl(sp: Record<string, string | undefined>, page: number) {
  const params = new URLSearchParams()
  Object.entries(sp).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && k !== 'page') params.set(k, v)
  })
  params.set('page', String(page))
  return params.toString()
}

export default async function AdminSalesPage({ searchParams }: PageProps) {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()
  const sp = await searchParams

  const today = sofiaToday()
  const fromDate = sp.from || today
  const toDate = sp.to || today
  const grouped = sp.grouped || ''
  const page = Math.max(1, parseInt(sp.page || '1') || 1)
  const offset = (page - 1) * PAGE_SIZE

  // Fetch filter options
  const [{ data: stores }, { data: categories }, { data: products }] = await Promise.all([
    supabase.from('stores').select('id, name').eq('is_active', true),
    supabase.from('categories').select('id, name').order('name'),
    supabase.from('products').select('id, name').eq('status', 'active').order('name'),
  ])

  let query = supabase
    .from('sales')
    .select('*, product:products!inner(name, category_id), store:stores(name), seller:users!sales_sold_by_fkey(display_name)', { count: 'exact' })
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
    .order('created_at', { ascending: false })
    .order('sale_group_id')
    .range(offset, offset + PAGE_SIZE - 1)

  if (sp.store) query = query.eq('store_id', sp.store)
  if (sp.product) query = query.eq('product_id', sp.product)
  if (sp.category) query = query.eq('product.category_id', sp.category)

  const { data: sales, count: totalCount } = await query
  const totalPages = Math.ceil((totalCount || 0) / PAGE_SIZE)
  const hasMore = page < totalPages
  const hasPrev = page > 1

  // Fetch totals for the ENTIRE period (not just current page)
  let totalsQuery = supabase
    .from('sales')
    .select('quantity, sale_price, payment_method, product:products!inner(category_id)')
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
    .eq('voided', false)
  if (sp.store) totalsQuery = totalsQuery.eq('store_id', sp.store)
  if (sp.product) totalsQuery = totalsQuery.eq('product_id', sp.product)
  if (sp.category) totalsQuery = totalsQuery.eq('product.category_id', sp.category)
  const { data: allActiveSales } = await totalsQuery

  const total = (allActiveSales || []).reduce((sum: number, s: any) => sum + s.quantity * Number(s.sale_price), 0)
  const cardTotal = (allActiveSales || []).filter((s: any) => s.payment_method === 'card').reduce((sum: number, s: any) => sum + s.quantity * Number(s.sale_price), 0)
  const cashTotal = (allActiveSales || []).filter((s: any) => s.payment_method !== 'card').reduce((sum: number, s: any) => sum + s.quantity * Number(s.sale_price), 0)

  // Grouped-by-product data
  let groupedProducts: { name: string; sales: number; qty: number; revenue: number; unitPrice: number }[] = []
  if (grouped === '1') {
    let gq = supabase
      .from('sales')
      .select('quantity, sale_price, product:products!inner(name)')
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate)
      .eq('voided', false)
    if (sp.store) gq = gq.eq('store_id', sp.store)
    if (sp.product) gq = gq.eq('product_id', sp.product)
    if (sp.category) gq = gq.eq('product.category_id', sp.category)
    const { data: gs } = await gq
    const byName: Record<string, { count: number; qty: number; rev: number }> = {}
    ;(gs || []).forEach((s: any) => {
      const n = s.product?.name || '?'
      if (!byName[n]) byName[n] = { count: 0, qty: 0, rev: 0 }
      byName[n].count++
      byName[n].qty += s.quantity
      byName[n].rev += s.quantity * Number(s.sale_price)
    })
    groupedProducts = Object.entries(byName)
      .map(([name, d]) => ({ name, sales: d.count, qty: d.qty, revenue: d.rev, unitPrice: d.qty > 0 ? d.rev / d.qty : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
  }

  // Compute group info: count, short ID, and color index per group
  const groupCounts: Record<string, number> = {}
  const groupMeta: Record<string, { shortId: string; color: string }> = {}
  const groupColors = ['border-l-blue-200 bg-blue-50/30', 'border-l-purple-200 bg-purple-50/30', 'border-l-teal-200 bg-teal-50/30', 'border-l-amber-200 bg-amber-50/30']
  let groupColorIdx = 0
  ;(sales || []).forEach((s: any) => {
    if (s.sale_group_id) {
      groupCounts[s.sale_group_id] = (groupCounts[s.sale_group_id] || 0) + 1
      if (!groupMeta[s.sale_group_id]) {
        groupMeta[s.sale_group_id] = {
          shortId: s.sale_group_id.replace(/-/g, '').substring(0, 4),
          color: groupColors[groupColorIdx % groupColors.length],
        }
        groupColorIdx++
      }
    }
  })

  // Track consecutive groups for visual grouping
  let lastGroupId: string | null = null
  const exportParams = new URLSearchParams({ from: fromDate, to: toDate })
  if (sp.store) exportParams.set('store', sp.store)
  if (sp.product) exportParams.set('product', sp.product)
  if (sp.category) exportParams.set('category', sp.category)
  const exportUrl = `/api/sales/export?${exportParams.toString()}`

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Продажби</h1>
        <a
          href={exportUrl}
          className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md text-sm hover:bg-green-700 transition-colors"
        >
          <Download className="h-4 w-4" />
          Експорт в Excel
        </a>
      </div>

      <SalesFilters
        fromDate={fromDate}
        toDate={toDate}
        store={sp.store}
        product={sp.product}
        category={sp.category}
        grouped={grouped}
        stores={(stores || []) as { id: string; name: string }[]}
        categories={(categories || []) as { id: string; name: string }[]}
        products={(products || []) as { id: string; name: string }[]}
      />

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Общо продажби</p>
          <p className="text-2xl font-bold">{total.toFixed(2)} €</p>
        </div>
        <div className="rounded-lg border bg-green-50 p-4">
          <p className="text-sm text-green-700">Плащания с карта</p>
          <p className="text-2xl font-bold text-green-700">{cardTotal.toFixed(2)} €</p>
        </div>
        <div className="rounded-lg border bg-blue-50 p-4">
          <p className="text-sm text-blue-700">Плащания в брой</p>
          <p className="text-2xl font-bold text-blue-700">{cashTotal.toFixed(2)} €</p>
        </div>
      </div>

      {/* Grouped by product */}
      {grouped === '1' && (
        <div>
          {groupedProducts.length === 0 ? (
            <p className="text-muted-foreground py-12 text-center">Няма продажби за избрания период</p>
          ) : (
            <div className="rounded-lg border bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="px-4 py-2.5 font-medium">Продукт</th>
                    <th className="px-4 py-2.5 font-medium text-center w-[100px]">Продажби</th>
                    <th className="px-4 py-2.5 font-medium text-center w-[100px]">Количество</th>
                    <th className="px-4 py-2.5 font-medium text-right w-[100px]">Ед. цена</th>
                    <th className="px-4 py-2.5 font-medium text-right w-[120px]">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedProducts.map((p, i) => (
                    <tr key={p.name} className={`border-b last:border-b-0 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                      <td className="px-4 py-2.5 font-medium">{p.name}</td>
                      <td className="px-4 py-2.5 text-center">{p.sales}</td>
                      <td className="px-4 py-2.5 text-center">{p.qty}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{p.unitPrice.toFixed(2)} €</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">{p.revenue.toFixed(2)} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sales list */}
      {grouped !== '1' && <div>
        {(sales || []).map((s: any, i: number) => {
          // Detect group start/change for visual grouping
          const isGroup = s.sale_group_id && groupCounts[s.sale_group_id] > 1
          const groupChanged = isGroup && s.sale_group_id !== lastGroupId
          if (groupChanged) lastGroupId = s.sale_group_id
          if (!isGroup) lastGroupId = null

          const time = sofiaTime(s.created_at)
          const dateStr = sofiaDate(s.sale_date)
          const meta = isGroup ? groupMeta[s.sale_group_id] : null

          return (
            <div key={s.id}>
              {groupChanged && meta && (
                <div className="text-[10px] text-blue-500 font-medium uppercase tracking-wider pt-2 pb-1 border-t border-blue-100 mt-1">
                  Група #{meta.shortId} &middot; {groupCounts[s.sale_group_id]} артикула
                </div>
              )}
              <div className={`flex items-center justify-between py-3 px-4 bg-white rounded border hover:border-slate-300 transition-colors border-l-4 mb-0.5 ${s.voided ? 'opacity-60' : ''} ${meta?.color || ''} ${isGroup ? '' : 'border-l-transparent'}`}>
                <div className="min-w-0">
                  <span className={`font-medium ${s.voided ? 'line-through' : ''}`}>{s.product?.name}</span>
                  <span className="text-slate-400 mx-1">&times;{s.quantity}</span>
                  <span className="text-sm text-muted-foreground">
                    &mdash; {s.store?.name} от {s.seller?.display_name}
                  </span>
                  {s.voided && (
                    <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
                      сторнирана
                    </span>
                  )}
                  {isGroup && (
                    <span className="ml-2 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                      група
                    </span>
                  )}
                  {s.payment_method && (
                    <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                      {s.payment_method === 'cash' ? 'Кеш' : s.payment_method === 'card' ? 'Карта' : 'Превод'}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0 ml-4 flex items-center gap-2">
                  {!s.voided && <VoidSaleButton saleId={s.id} />}
                  <div>
                    <span className="font-semibold">{(s.quantity * Number(s.sale_price)).toFixed(2)} €</span>
                    <p className="text-xs text-muted-foreground">{dateStr} {time}</p>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {(!sales || sales.length === 0) && (
          <p className="text-muted-foreground py-12 text-center">Няма продажби за избрания период</p>
        )}
      </div>}

      {/* Pagination */}
      {grouped !== '1' && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            Страница {page} от {totalPages} (общо {totalCount})
          </p>
          <div className="flex gap-2">
            {hasPrev && (
              <a
                href={`/sales?${buildPageUrl(sp, page - 1)}`}
                className="px-4 py-2 rounded border text-sm hover:bg-slate-50 transition-colors"
              >
                ← Назад
              </a>
            )}
            {hasMore && (
              <a
                href={`/sales?${buildPageUrl(sp, page + 1)}`}
                className="px-4 py-2 rounded border text-sm hover:bg-slate-50 transition-colors"
              >
                Напред →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
