'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

function truncateName(name: string, max: number = 18): string {
  return name.length > max ? name.slice(0, max) + '...' : name
}

export default function ReportsPage() {
  const [days, setDays] = useState('30')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/reports?days=${days}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Грешка при зареждане'))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="p-8 text-muted-foreground">Зареждане...</div>
  if (error) return <div className="p-8 text-red-600">{error}</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Отчети</h1>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 дни</SelectItem>
            <SelectItem value="30">30 дни</SelectItem>
            <SelectItem value="90">90 дни</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Общо продажби</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalRevenue?.toFixed(0) || 0} €</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Брой продажби</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalCount || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Уникални продукти</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.uniqueProducts || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Среден чек</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.totalCount > 0 ? (data.totalRevenue / data.totalCount).toFixed(0) : '0'} €
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Day */}
        <Card>
          <CardHeader><CardTitle className="text-base">Приходи по дни</CardTitle></CardHeader>
          <CardContent>
            {data.byDay?.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sale_date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} €`} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(0)} €`, 'Приходи']} />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" name="Приходи" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-12">Няма данни</p>
            )}
          </CardContent>
        </Card>

        {/* Top Products by Quantity */}
        <Card>
          <CardHeader><CardTitle className="text-base">Топ продукти (брой)</CardTitle></CardHeader>
          <CardContent>
            {data.topProducts?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.topProducts} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={150}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => truncateName(v, 18)}
                  />
                  <Tooltip
                    formatter={(v: any) => [v, 'Продадени бройки']}
                    labelFormatter={(label) => label}
                  />
                  <Bar dataKey="quantity" fill="#10b981" name="Продадени" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-12">Няма данни</p>
            )}
          </CardContent>
        </Card>

        {/* Top Products by Revenue */}
        <Card>
          <CardHeader><CardTitle className="text-base">Топ продукти (приходи)</CardTitle></CardHeader>
          <CardContent>
            {data.topRevenue?.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.topRevenue}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={100}
                    dataKey="revenue"
                    nameKey="name"
                    label={({ name, percent }: any) => `${truncateName(name, 12)} ${((percent || 0) * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}
                  >
                    {data.topRevenue.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(0)} €`, 'Приходи']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-12">Няма данни</p>
            )}
          </CardContent>
        </Card>

        {/* Low Stock */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ниски наличности</CardTitle></CardHeader>
          <CardContent>
            {(!data.lowStock || data.lowStock.length === 0) ? (
              <p className="text-muted-foreground text-center py-12">Всички продукти са с достатъчни наличности</p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-auto">
                {data.lowStock.map((p: any) => (
                  <div key={p.id} className="flex justify-between py-2 border-b last:border-0">
                    <span className="text-sm truncate mr-4">{p.name}</span>
                    <span className={p.quantity_on_hand === 0 ? 'text-red-600 font-semibold shrink-0' : 'text-amber-600 shrink-0'}>
                      {p.quantity_on_hand} бр
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
