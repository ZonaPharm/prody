import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

interface PageProps {
  searchParams: Promise<{ store?: string; date?: string }>
}

export default async function AdminSalesPage({ searchParams }: PageProps) {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()
  const sp = await searchParams

  // Fetch active stores for filter
  const { data: stores } = await supabase.from('stores').select('id, name').eq('is_active', true)
  const date = sp.date || new Date().toISOString().split('T')[0]

  let query = supabase
    .from('sales')
    .select('*, product:products(name), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
    .order('created_at', { ascending: false })

  if (sp.store) query = query.eq('store_id', sp.store)
  if (date) query = query.eq('sale_date', date)

  const { data: sales } = await query
  const total = (sales || []).reduce((sum: number, s: any) => sum + s.quantity * Number(s.sale_price), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Продажби</h1>
      </div>

      {/* Simple date filter */}
      <div className="flex items-center gap-3">
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className="border rounded px-3 py-2 text-sm" />
          {stores && stores.length > 0 && (
            <select name="store" defaultValue={sp.store || ''} className="border rounded px-3 py-2 text-sm">
              <option value="">Всички магазини</option>
              {stores.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Филтрирай</button>
        </form>
      </div>

      <p className="text-muted-foreground">
        Общо за периода: <strong className="text-foreground">{total.toFixed(2)} €</strong>
      </p>

      <div className="space-y-2">
        {(sales || []).map((s: any) => (
          <div key={s.id} className="flex items-center justify-between py-3 px-4 bg-white rounded border">
            <div>
              <span className="font-medium">{s.product?.name}</span>
              <span className="text-slate-400 mx-1">&times;{s.quantity}</span>
              <span className="text-sm text-muted-foreground">
                &mdash; {s.store?.name} от {s.seller?.display_name}
              </span>
            </div>
            <span className="font-semibold">{(s.quantity * Number(s.sale_price)).toFixed(2)} €</span>
          </div>
        ))}
        {(!sales || sales.length === 0) && (
          <p className="text-muted-foreground py-8 text-center">Няма продажби за избрания период</p>
        )}
      </div>
    </div>
  )
}
