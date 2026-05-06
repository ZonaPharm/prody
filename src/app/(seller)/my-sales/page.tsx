import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Package2, Download } from 'lucide-react'
import { MySalesFilters } from './filters'

type SaleRow = {
  id: string
  quantity: number
  sale_price: number
  sale_date: string
  product_name: string
  store_name: string
  sale_group_id: string | null
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function MySalesPage({ searchParams }: PageProps) {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)

  let storeId = user.store_id

  if (!storeId && user.role === 'admin' && effectiveRole === 'seller') {
    const supabase = await createServerSupabaseClient()
    const { data: store } = await (supabase
      .from('stores') as any)
      .select('id')
      .limit(1)
      .single()
    if (store) storeId = store.id
  }

  if (!storeId) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p>Нямате зададен магазин. Свържете се с администратор.</p>
      </div>
    )
  }

  const params = await searchParams
  const supabase = await createServerSupabaseClient()

  const today = new Date().toISOString().split('T')[0]
  const fromDate = params.from || today
  const toDate = params.to || today

  let query = supabase
    .from('sales')
    .select('id, quantity, sale_price, sale_date, sale_group_id, product:products(name), store:stores(name)')
    .eq('sold_by', user.id)
    .eq('store_id', storeId)
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
    .order('created_at', { ascending: false })

  const { data: sales } = await query

  const rows: SaleRow[] = (sales || []).map((s: any) => ({
    id: s.id,
    quantity: s.quantity,
    sale_price: s.sale_price,
    sale_date: s.sale_date,
    sale_group_id: s.sale_group_id,
    product_name: Array.isArray(s.product) ? (s.product[0]?.name ?? '—') : (s.product?.name ?? '—'),
    store_name: Array.isArray(s.store) ? (s.store[0]?.name ?? '—') : (s.store?.name ?? '—'),
  }))

  const total = rows.reduce((sum, r) => sum + r.quantity * r.sale_price, 0)
  const uniqueProducts = new Set(rows.map(r => r.product_name)).size
  const groupSales = rows.filter(r => r.sale_group_id).length

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
        <div className="flex items-center gap-3">
          <MySalesFilters from={fromDate} to={toDate} />
          <a
            href={`/api/sales/export?from=${fromDate}&to=${toDate}`}
            className="inline-flex items-center gap-1.5 bg-green-600 text-white px-3 py-2 rounded-md text-sm hover:bg-green-700 transition-colors shrink-0"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Общо продажби</p>
          <p className="text-2xl font-bold tabular-nums">{total.toFixed(2)} €</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Брой продажби</p>
          <p className="text-2xl font-bold tabular-nums">{rows.length}</p>
          <p className="text-xs text-muted-foreground">за {uniqueProducts} продукта</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Среден чек</p>
          <p className="text-2xl font-bold tabular-nums">
            {rows.length > 0 ? (total / rows.length).toFixed(2) : '0.00'} €
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
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Продукт</th>
                  <th className="text-center px-4 py-3 font-medium">Кол.</th>
                  <th className="text-right px-4 py-3 font-medium">Цена</th>
                  <th className="text-right px-4 py-3 font-medium">Сума</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Обект</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Дата</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{row.product_name}</span>
                      {row.sale_group_id && (
                        <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                          група
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{row.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.sale_price.toFixed(2)} €</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {(row.quantity * row.sale_price).toFixed(2)} €
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{row.store_name}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell tabular-nums">
                      {new Date(row.sale_date).toLocaleDateString('bg-BG')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={3} className="px-4 py-3 text-right">Общо:</td>
                  <td className="px-4 py-3 text-right tabular-nums">{total.toFixed(2)} €</td>
                  <td className="hidden md:table-cell" />
                  <td className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
