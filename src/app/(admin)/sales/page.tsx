import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Download } from 'lucide-react'

interface PageProps {
  searchParams: Promise<{ store?: string; from?: string; to?: string }>
}

export default async function AdminSalesPage({ searchParams }: PageProps) {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()
  const sp = await searchParams

  const today = new Date().toISOString().split('T')[0]
  const { data: stores } = await supabase.from('stores').select('id, name').eq('is_active', true)
  const fromDate = sp.from || today
  const toDate = sp.to || today

  let query = supabase
    .from('sales')
    .select('*, product:products(name), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate)
    .order('created_at', { ascending: false })

  if (sp.store) query = query.eq('store_id', sp.store)

  const { data: sales } = await query
  const total = (sales || []).reduce((sum: number, s: any) => sum + s.quantity * Number(s.sale_price), 0)
  const exportUrl = `/api/sales/export?from=${fromDate}&to=${toDate}${sp.store ? `&store=${sp.store}` : ''}`

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
            <select name="store" defaultValue={sp.store || ''} className="border rounded px-3 py-2 text-sm">
              <option value="">Всички обекти</option>
              {stores.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
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
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Брой транзакции</p>
          <p className="text-2xl font-bold">{(sales || []).length}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-muted-foreground">Среден чек</p>
          <p className="text-2xl font-bold">
            {(sales || []).length > 0 ? (total / (sales || []).length).toFixed(2) : '0.00'} €
          </p>
        </div>
      </div>

      {/* Sales list */}
      <div className="space-y-2">
        {(sales || []).map((s: any) => (
          <div key={s.id} className="flex items-center justify-between py-3 px-4 bg-white rounded border hover:border-slate-300 transition-colors">
            <div className="min-w-0">
              <span className="font-medium">{s.product?.name}</span>
              <span className="text-slate-400 mx-1">&times;{s.quantity}</span>
              <span className="text-sm text-muted-foreground">
                &mdash; {s.store?.name} от {s.seller?.display_name}
              </span>
              {s.sale_group_id && (
                <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                  група
                </span>
              )}
            </div>
            <div className="text-right shrink-0 ml-4">
              <span className="font-semibold">{(s.quantity * Number(s.sale_price)).toFixed(2)} €</span>
              <p className="text-xs text-muted-foreground">{new Date(s.sale_date).toLocaleDateString('bg-BG')}</p>
            </div>
          </div>
        ))}
        {(!sales || sales.length === 0) && (
          <p className="text-muted-foreground py-12 text-center">Няма продажби за избрания период</p>
        )}
      </div>
    </div>
  )
}
