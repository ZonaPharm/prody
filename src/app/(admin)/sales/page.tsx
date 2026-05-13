import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Download } from 'lucide-react'
import { VoidSaleButton } from '@/components/sales/void-sale-button'

interface PageProps {
  searchParams: Promise<{ store?: string; from?: string; to?: string; product?: string; category?: string; page?: string }>
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

  const today = new Date().toISOString().split('T')[0]
  const fromDate = sp.from || today
  const toDate = sp.to || today
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
    .select('quantity, sale_price, payment_method')
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

  // Compute group counts so we only show "група" for 2+ items
  const groupCounts: Record<string, number> = {}
  ;(sales || []).forEach((s: any) => {
    if (s.sale_group_id) groupCounts[s.sale_group_id] = (groupCounts[s.sale_group_id] || 0) + 1
  })
  const exportParams = new URLSearchParams({ from: fromDate, to: toDate })
  if (sp.store) exportParams.set('store', sp.store)
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

      {/* Date + store filter */}
      <form className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">От</label>
          <input type="date" name="from" defaultValue={fromDate} className="border rounded px-3 py-2 text-sm w-[140px]" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">До</label>
          <input type="date" name="to" defaultValue={toDate} className="border rounded px-3 py-2 text-sm w-[140px]" />
        </div>
        {stores && stores.length > 0 && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Обект</label>
            <select name="store" defaultValue={sp.store || ''} className="border rounded px-3 py-2 text-sm max-w-[180px]">
              <option value="">Всички обекти</option>
              {stores.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        {categories && categories.length > 0 && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Категория</label>
            <select name="category" defaultValue={sp.category || ''} className="border rounded px-3 py-2 text-sm max-w-[180px]">
              <option value="">Всички категории</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        {products && products.length > 0 && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Продукт</label>
            <select name="product" defaultValue={sp.product || ''} className="border rounded px-3 py-2 text-sm max-w-[220px]">
              <option value="">Всички продукти</option>
              {products.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Филтрирай</button>
      </form>

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

      {/* Sales list */}
      <div className="space-y-2">
        {(sales || []).map((s: any) => (
          <div key={s.id} className={`flex items-center justify-between py-3 px-4 bg-white rounded border hover:border-slate-300 transition-colors ${s.voided ? 'opacity-60' : ''}`}>
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
              {s.sale_group_id && groupCounts[s.sale_group_id] > 1 && (
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
                <p className="text-xs text-muted-foreground">{new Date(s.sale_date).toLocaleDateString('bg-BG')}</p>
              </div>
            </div>
          </div>
        ))}
        {(!sales || sales.length === 0) && (
          <p className="text-muted-foreground py-12 text-center">Няма продажби за избрания период</p>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
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
