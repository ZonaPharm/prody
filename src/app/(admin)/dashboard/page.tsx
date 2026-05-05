import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Package2, ShoppingBag, Clock, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

  const [
    { count: totalProducts },
    { count: listedProducts },
    { count: orderedCount },
    { count: lowStockCount },
    { data: todaySales },
    { data: weekSales },
  ] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'listed'),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'ordered'),
    supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'listed')
      .lte('quantity_on_hand', 5),
    supabase.from('sales').select('quantity, sale_price').gte('sale_date', today),
    supabase.from('sales').select('quantity, sale_price').gte('sale_date', weekAgo),
  ])

  const todayTotal = (todaySales || []).reduce(
    (sum: number, s: any) => sum + s.quantity * Number(s.sale_price),
    0
  )
  const weekTotal = (weekSales || []).reduce(
    (sum: number, s: any) => sum + s.quantity * Number(s.sale_price),
    0
  )
  const todayCount = (todaySales || []).length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Дашборд</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Продукти</CardTitle>
            <Package2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProducts ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {listedProducts ?? 0} в каталог, {orderedCount ?? 0} поръчани
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Продажби днес</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayTotal.toFixed(0)} лв</div>
            <p className="text-xs text-muted-foreground">{todayCount} транзакции</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Седмица</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weekTotal.toFixed(0)} лв</div>
            <p className="text-xs text-muted-foreground">последните 7 дни</p>
          </CardContent>
        </Card>

        <Card className="border-amber-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Ниски наличности</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{lowStockCount ?? 0}</div>
            <Link href="/reports" className="text-xs text-blue-600 hover:underline">
              Виж кои
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
