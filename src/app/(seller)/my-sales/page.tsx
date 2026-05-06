import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Package2 } from 'lucide-react'

type SaleRow = {
  id: string
  quantity: number
  sale_price: number
  sale_date: string
  product_name: string
}

export default async function MySalesPage() {
  const user = await requireAuth()

  if (!user.store_id) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p>Нямате зададен магазин. Свържете се с администратор.</p>
      </div>
    )
  }

  const supabase = await createServerSupabaseClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: sales } = await supabase
    .from('sales')
    .select('id, quantity, sale_price, sale_date, product:products(name)')
    .eq('sold_by', user.id)
    .eq('sale_date', today)
    .order('created_at', { ascending: false })

  const rows: SaleRow[] = (sales || []).map((s: any) => ({
    id: s.id,
    quantity: s.quantity,
    sale_price: s.sale_price,
    sale_date: s.sale_date,
    product_name: Array.isArray(s.product) ? (s.product[0]?.name ?? '—') : (s.product?.name ?? '—'),
  }))

  const dailyTotal = rows.reduce((sum, r) => sum + r.quantity * r.sale_price, 0)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Моите продажби</h1>
        <p className="text-muted-foreground mt-1">Продажби за днес &mdash; {today}</p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">
          <Package2 className="mx-auto h-10 w-10 mb-3 text-slate-300" />
          <p>Няма продажби за днес</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Продукт</th>
                <th className="text-center px-4 py-3 font-medium">Количество</th>
                <th className="text-right px-4 py-3 font-medium">Цена</th>
                <th className="text-right px-4 py-3 font-medium">Сума</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-3">{row.product_name}</td>
                  <td className="px-4 py-3 text-center">{row.quantity}</td>
                  <td className="px-4 py-3 text-right">{row.sale_price.toFixed(2)} €</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {(row.quantity * row.sale_price).toFixed(2)} €
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={3} className="px-4 py-3 text-right">Общо за днес:</td>
                <td className="px-4 py-3 text-right">{dailyTotal.toFixed(2)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
