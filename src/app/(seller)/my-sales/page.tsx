import React from 'react'
import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { Package2 } from 'lucide-react'
import { VoidSaleButton } from '@/components/sales/void-sale-button'

export const dynamic = 'force-dynamic'
import { MySalesFilters } from './filters'
import { sofiaToday, sofiaTime, sofiaDate } from '@/lib/date-utils'

type SaleRow = {
  id: string
  quantity: number
  sale_price: number
  sale_date: string
  created_at: string
  product_name: string
  store_name: string
  sale_group_id: string | null
  voided: boolean
  payment_method: string
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>
}

const MY_PAGE_SIZE = 50

function buildMyPageUrl(params: Record<string, string | undefined>, page: number) {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && k !== 'page') p.set(k, v)
  })
  p.set('page', String(page))
  return p.toString()
}

export default async function MySalesPage({ searchParams }: PageProps) {
  const user = await requireAuth()

  const params = await searchParams
  const storeId = user.store_id
  const admin = createAdminClient()

  const today = sofiaToday()
  const fromDate = params.from || today
  const toDate = params.to || today
  const page = Math.max(1, parseInt(params.page || '1') || 1)
  const offset = (page - 1) * MY_PAGE_SIZE

  let query = admin
    .from('sales')
    .select('id, quantity, sale_price, sale_date, sale_group_id, voided, created_at, payment_method, product:products(name), store:stores(name)', { count: 'exact' })
    .eq('sold_by', user.id)
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
    .order('created_at', { ascending: false })
    .order('sale_group_id')
    .range(offset, offset + MY_PAGE_SIZE - 1)

  // Only filter by store for real sellers (not admin impersonating)
  if (user.role === 'seller' && storeId) {
    query = query.eq('store_id', storeId)
  }

  if (user.role === 'seller' && !storeId) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p>Нямате зададен магазин. Свържете се с администратор.</p>
      </div>
    )
  }

  const { data: sales, count: totalCount } = await query
  const totalPages = Math.ceil((totalCount || 0) / MY_PAGE_SIZE)

  // Fetch totals for ENTIRE period (not just current page)
  let totalsQuery = admin
    .from('sales')
    .select('quantity, sale_price')
    .eq('sold_by', user.id)
    .eq('voided', false)
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
  if (user.role === 'seller' && storeId) {
    totalsQuery = totalsQuery.eq('store_id', storeId)
  }
  const { data: allActiveSales } = await totalsQuery

  const total = (allActiveSales || []).reduce((sum: number, s: any) => sum + s.quantity * Number(s.sale_price), 0)
  const activeCount = (allActiveSales || []).length
  const uniqueProducts = new Set((allActiveSales || []).map((s: any) => s.product_id)).size
  const groupSales = (allActiveSales || []).filter((s: any) => s.sale_group_id).length

  const rows: SaleRow[] = (sales || []).map((s: any) => ({
    id: s.id,
    quantity: s.quantity,
    sale_price: s.sale_price,
    sale_date: s.sale_date,
    created_at: s.created_at,
    sale_group_id: s.sale_group_id,
    voided: s.voided || false,
    product_name: Array.isArray(s.product) ? (s.product[0]?.name ?? '—') : (s.product?.name ?? '—'),
    store_name: Array.isArray(s.store) ? (s.store[0]?.name ?? '—') : (s.store?.name ?? '—'),
    payment_method: s.payment_method || 'cash',
  }))

  const groupCounts: Record<string, number> = {}
  rows.forEach(r => { if (r.sale_group_id) groupCounts[r.sale_group_id] = (groupCounts[r.sale_group_id] || 0) + 1 })

  const groupColors = ['border-l-blue-200 bg-blue-50/30', 'border-l-purple-200 bg-purple-50/30', 'border-l-teal-200 bg-teal-50/30', 'border-l-amber-200 bg-amber-50/30']
  let groupColorIdx = 0
  const groupMeta: Record<string, { color: string }> = {}
  rows.forEach(r => {
    if (r.sale_group_id && groupCounts[r.sale_group_id] > 1 && !groupMeta[r.sale_group_id]) {
      groupMeta[r.sale_group_id] = { color: groupColors[groupColorIdx % groupColors.length] }
      groupColorIdx++
    }
  })
  let lastGroupId: string | null = null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Моите продажби</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {fromDate === today && toDate === today
              ? 'Продажби за днес'
              : `${fromDate} — ${toDate}`}
          </p>
        </div>
        <MySalesFilters from={fromDate} to={toDate} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Общо продажби</p>
          <p className="text-2xl font-bold tabular-nums">{total.toFixed(2)} €</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Брой продажби</p>
          <p className="text-2xl font-bold tabular-nums">{activeCount}</p>
          <p className="text-xs text-muted-foreground">за {uniqueProducts} продукта</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Среден чек</p>
          <p className="text-2xl font-bold tabular-nums">
            {activeCount > 0 ? (total / activeCount).toFixed(2) : '0.00'} €
          </p>
          {groupSales > 0 && (
            <p className="text-xs text-muted-foreground">{groupSales} в групови продажби</p>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">
          <Package2 className="mx-auto h-10 w-10 mb-3 text-slate-300" />
          <p>Няма продажби за избрания период</p>
        </div>
      ) : (
        <>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Страница {page} от {totalPages} (общо {totalCount})
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <a href={`/my-sales?${buildMyPageUrl(params, page - 1)}`} className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50">
                    ← Назад
                  </a>
                )}
                {page < totalPages && (
                  <a href={`/my-sales?${buildMyPageUrl(params, page + 1)}`} className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50">
                    Напред →
                  </a>
                )}
              </div>
            </div>
          )}
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium">Продукт</th>
                  <th className="text-center px-2 py-2.5 font-medium hidden sm:table-cell">Кол.</th>
                  <th className="text-right px-2 py-2.5 font-medium hidden sm:table-cell">Цена</th>
                  <th className="text-right px-3 py-2.5 font-medium">Сума</th>
                  <th className="text-center px-2 py-2.5 font-medium">Плащане</th>
                  <th className="text-left px-2 py-2.5 font-medium hidden md:table-cell">Обект</th>
                  <th className="text-right px-2 py-2.5 font-medium">Дата</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isGroup = row.sale_group_id && groupCounts[row.sale_group_id] > 1
                  const groupChanged = isGroup && row.sale_group_id !== lastGroupId
                  if (groupChanged) lastGroupId = row.sale_group_id
                  if (!isGroup) lastGroupId = null
                  const gid = row.sale_group_id!
                  const meta = isGroup ? groupMeta[gid] : null

                  return (
                    <React.Fragment key={row.id}>
                      {groupChanged && meta && (
                        <tr className="border-t-2 border-blue-200">
                          <td colSpan={8} className="px-3 py-1 text-[10px] text-blue-500 font-medium uppercase tracking-wider">
                            Група &middot; {groupCounts[gid]} артикула
                          </td>
                        </tr>
                      )}
                  <tr className={`border-b last:border-0 hover:bg-slate-50/50 border-l-4 ${row.voided ? 'opacity-50' : ''} ${meta?.color || 'border-l-transparent'}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className={`font-medium ${row.voided ? 'line-through' : ''}`}>{row.product_name}</span>
                        <span className="text-[10px] text-muted-foreground sm:hidden tabular-nums">
                          {row.quantity} × {row.sale_price.toFixed(2)} €
                        </span>
                      </div>
                      <div className="flex gap-1 mt-0.5">
                        {row.voided && (
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
                            сторнирана
                          </span>
                        )}
                        {row.sale_group_id && groupCounts[row.sale_group_id] > 1 && (
                          <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                            група
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums hidden sm:table-cell">{row.quantity}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums hidden sm:table-cell">{row.sale_price.toFixed(2)} €</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {(row.quantity * row.sale_price).toFixed(2)} €
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        row.payment_method === 'card' ? 'bg-purple-100 text-purple-700' :
                        row.payment_method === 'transfer' ? 'bg-amber-100 text-amber-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {row.payment_method === 'card' ? 'Карта' : row.payment_method === 'transfer' ? 'Превод' : 'Кеш'}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground hidden md:table-cell">{row.store_name}</td>
                    <td className="px-2 py-2.5 text-right text-muted-foreground tabular-nums text-[11px]">
                      <span className="sm:hidden">{sofiaDate(row.sale_date).slice(5)}</span>
                      <span className="hidden sm:inline">{sofiaDate(row.sale_date)}</span>
                      <br />
                      <span className="text-[10px]">{sofiaTime(row.created_at)}</span>
                    </td>
                    <td className="px-1 py-2.5">
                      {!row.voided && <VoidSaleButton saleId={row.id} />}
                    </td>
                  </tr>
                  </React.Fragment>
                )})}
              </tbody>
            </table>
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Страница {page} от {totalPages} (общо {totalCount})
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <a href={`/my-sales?${buildMyPageUrl(params, page - 1)}`} className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50">
                  ← Назад
                </a>
              )}
              {page < totalPages && (
                <a href={`/my-sales?${buildMyPageUrl(params, page + 1)}`} className="px-3 py-1.5 rounded border text-sm hover:bg-slate-50">
                  Напред →
                </a>
              )}
            </div>
          </div>
        )}
        </>
      )}
    </div>
  )
}
