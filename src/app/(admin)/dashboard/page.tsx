import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Package2, ShoppingBag, AlertTriangle, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { SalesChart, TopProductsChart } from './charts'
import { StoreSalesSection } from './store-sales-section'

export default async function DashboardPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

  const [
    { count: totalProducts },
    { count: activeProducts },
    { count: inactiveOrdered },
    { count: lowStockCount },
    { data: todaySales },
    { data: monthSales },
    { data: topProducts },
    { data: weekDailySales },
    { data: stores },
    { data: monthStoreSales },
  ] = await Promise.all([
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'inactive').eq('inactive_reason', 'ordered'),
    supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'active').lte('quantity_on_hand', 5),
    supabase.from('sales').select('quantity, sale_price').gte('sale_date', today),
    supabase.from('sales').select('quantity, sale_price, sale_date').gte('sale_date', monthAgo).order('sale_date'),
    supabase.from('sales').select('quantity, sale_price, product:products(name)').gte('sale_date', monthAgo),
    supabase.from('sales').select('quantity, sale_price, sale_date').gte('sale_date', weekAgo).order('sale_date'),
    supabase.from('stores').select('id, name, is_warehouse').eq('is_active', true).order('name'),
    supabase.from('sales').select('quantity, sale_price, store_id').gte('sale_date', monthAgo),
  ])

  const sumReducer = (sum: number, s: any) => sum + s.quantity * Number(s.sale_price)
  const todayTotal = (todaySales || []).reduce(sumReducer, 0)
  const monthTotal = (monthSales || []).reduce(sumReducer, 0)
  const todayCount = (todaySales || []).length

  // Daily breakdown for last 7 days
  const dailyMap: Record<string, number> = {}
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    dailyMap[d] = 0
  }
  ;(weekDailySales || []).forEach((s: any) => {
    if (dailyMap[s.sale_date] !== undefined) {
      dailyMap[s.sale_date] += s.quantity * Number(s.sale_price)
    }
  })
  const chartData = Object.entries(dailyMap).map(([date, amount]) => ({
    date: new Date(date).toLocaleDateString('bg-BG', { weekday: 'short', day: 'numeric' }),
    amount: Math.round(amount * 100) / 100,
  }))

  // Non-warehouse stores for the store sales section
  const nonWarehouseStores = (stores || []).filter((s: any) => !s.is_warehouse)

  // Per-store revenue for last 30 days
  const storeRevenue: Record<string, number> = {}
  ;(monthStoreSales || []).forEach((s: any) => {
    storeRevenue[s.store_id] = (storeRevenue[s.store_id] || 0) + s.quantity * Number(s.sale_price)
  })

  // Top products
  const productMap: Record<string, number> = {}
  ;(topProducts || []).forEach((s: any) => {
    const name = Array.isArray(s.product) ? (s.product[0]?.name || '—') : (s.product?.name || '—')
    productMap[name] = (productMap[name] || 0) + s.quantity * Number(s.sale_price)
  })
  const topProductsData = Object.entries(productMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Табло</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Продукти</CardTitle>
            <Package2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProducts ?? 0}</div>
            <p className="text-xs text-muted-foreground">{activeProducts ?? 0} активни, {inactiveOrdered ?? 0} поръчани</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Днес</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayTotal.toFixed(0)} €</div>
            <p className="text-xs text-muted-foreground">{todayCount} продажби</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Месец</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{monthTotal.toFixed(0)} €</div>
            <p className="text-xs text-muted-foreground">последните 30 дни</p>
          </CardContent>
        </Card>

        <Card className="border-amber-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Ниски наличности</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{lowStockCount ?? 0}</div>
            <Link href="/reports" className="text-xs text-blue-600 hover:underline">Виж кои</Link>
          </CardContent>
        </Card>

      </div>

      {/* Store revenue KPIs */}
      {nonWarehouseStores.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {nonWarehouseStores.map((store: any) => {
            const revenue = Math.round((storeRevenue[store.id] || 0) * 100) / 100
            return (
              <Card key={store.id}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium truncate">{store.name}</CardTitle>
                  <ShoppingBag className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{revenue.toFixed(0)} €</div>
                  <p className="text-xs text-muted-foreground">оборот за 30 дни</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Продажби по дни</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart data={chartData} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Топ продукти (30 дни)</CardTitle>
          </CardHeader>
          <CardContent>
            {topProductsData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Няма продажби за периода</p>
            ) : (
              <TopProductsChart data={topProductsData} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sales by store — client component with date selector */}
      {nonWarehouseStores.length > 0 && (
        <StoreSalesSection stores={nonWarehouseStores.map((s: any) => ({ id: s.id, name: s.name }))} />
      )}
    </div>
  )
}
