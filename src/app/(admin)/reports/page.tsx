'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Download, Building2, FileSpreadsheet, Loader2, Package } from 'lucide-react'

function truncateName(name: string, max: number = 22): string {
  return name.length > max ? name.slice(0, max) + '...' : name
}

export default function ReportsPage() {
  const today = new Date().toISOString().split('T')[0]
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exportStoreId, setExportStoreId] = useState('')
  const [exportLoading, setExportLoading] = useState('')
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])

  const fetchData = useCallback(() => {
    setLoading(true)
    const days = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1
    fetch(`/api/reports?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Грешка при зареждане'))
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setStores(d.filter((s: any) => !s.is_warehouse))
    }).catch(() => {})
  }, [])

  const handleExport = async (type: string) => {
    setExportLoading(type)
    try {
      const res = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          from,
          to,
          store_id: (exportStoreId && exportStoreId !== '__all__') ? exportStoreId : null,
        }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const labels: Record<string, string> = { store: 'po-obekti', product: 'po-produkti', detail: 'palen-detail' }
      a.download = `${labels[type] || type}-${from}-${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Грешка при експорт')
    } finally {
      setExportLoading('')
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Зареждане...</div>
  if (error) return <div className="p-8 text-red-600">{error}</div>
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Отчети</h1>
        <form onSubmit={(e) => { e.preventDefault(); fetchData() }} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">От</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">До</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[140px] h-9 text-sm" />
          </div>
          <Button type="submit" variant="outline" size="sm" className="h-9">Покажи</Button>
        </form>
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
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[...data.topRevenue].reverse()} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v} €`} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={170}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => truncateName(v, 24)}
                  />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(0)} €`, 'Приходи']} />
                  <Bar dataKey="revenue" fill="#8b5cf6" name="Приходи" radius={[0, 4, 4, 0]} />
                </BarChart>
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
              <div className="space-y-2 max-h-[320px] overflow-auto">
                {data.lowStock.map((p: any) => (
                  <div key={p.id} className="py-2 border-b last:border-0">
                    <div className="flex justify-between items-start">
                      <span className="text-sm truncate mr-2">{p.name}</span>
                      <span className={p.quantity_on_hand === 0 ? 'text-red-600 font-semibold shrink-0 ml-auto' : 'text-amber-600 shrink-0 ml-auto'}>
                        {p.quantity_on_hand} бр
                      </span>
                    </div>
                    {p.stores && p.stores.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {p.stores.map((s: any) => (
                          <span key={s.name} className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                            {s.name}
                            <span className={s.qty <= 2 ? 'font-semibold text-red-500' : ''}>{s.qty} бр</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Export section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5" />
            Експорт
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Изтеглете данните в Excel формат с автофилтри и форматиране
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium">От дата</label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">До дата</label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Магазин</label>
              <Select value={exportStoreId || '__all__'} onValueChange={setExportStoreId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Всички магазини" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Всички магазини</SelectItem>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-1"
              onClick={() => handleExport('store')} disabled={exportLoading === 'store'}>
              {exportLoading === 'store' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Building2 className="h-5 w-5" />}
              <span className="font-medium">По обекти</span>
              <span className="text-[10px] text-muted-foreground">Оборот и брой по магазин</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-1"
              onClick={() => handleExport('product')} disabled={exportLoading === 'product'}>
              {exportLoading === 'product' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Package className="h-5 w-5" />}
              <span className="font-medium">По продукти</span>
              <span className="text-[10px] text-muted-foreground">Количество и сума по продукт</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-1"
              onClick={() => handleExport('detail')} disabled={exportLoading === 'detail'}>
              {exportLoading === 'detail' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5" />}
              <span className="font-medium">Пълен детайл</span>
              <span className="text-[10px] text-muted-foreground">Всяка продажба като ред</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
