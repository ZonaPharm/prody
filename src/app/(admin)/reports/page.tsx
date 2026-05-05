'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Продажби по дни</CardTitle></CardHeader>
          <CardContent>
            {data.byDay?.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sale_date" tick={{ fontSize: 12 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#3b82f6" name="Брой продажби" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-12">Няма данни</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Топ продукти</CardTitle></CardHeader>
          <CardContent>
            {data.topProducts?.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="quantity" fill="#10b981" name="Продадени" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-center py-12">Няма данни</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ниски наличности</CardTitle></CardHeader>
          <CardContent>
            {data.lowStock?.length === 0 ? (
              <p className="text-muted-foreground">Всички продукти са с достатъчни наличности</p>
            ) : (
              <div className="space-y-2">
                {data.lowStock.map((p: any) => (
                  <div key={p.id} className="flex justify-between py-2 border-b">
                    <span>{p.name}</span>
                    <span className={p.quantity_on_hand === 0 ? 'text-red-600 font-semibold' : 'text-amber-600'}>
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
