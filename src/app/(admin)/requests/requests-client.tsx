'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Loader2, ArrowRightLeft, ChevronDown, ChevronRight, Package } from 'lucide-react'

interface Request {
  id: string
  product_id: string
  product_name: string
  store_id: string
  store_name: string
  quantity: number
  status: string
  notes: string | null
  created_at: string
}

export function RequestsClient({ requests: initialRequests }: { requests: Request[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [loading, setLoading] = useState<string | null>(null)
  const [fulfillProduct, setFulfillProduct] = useState<{ id: string; name: string; entries: Request[]; totalQty: number } | null>(null)
  const [stockData, setStockData] = useState<any[]>([])
  const [transferQtys, setTransferQtys] = useState<Record<string, number>>({})
  const [fulfilling, setFulfilling] = useState(false)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())

  const toggleExpand = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const openFulfill = async (productId: string, productName: string, entries: Request[], totalQty: number) => {
    setFulfillProduct({ id: productId, name: productName, entries, totalQty })
    setTransferQtys({})
    try {
      // Use first entry's id to get stock data
      const res = await fetch(`/api/inventory/requests/${entries[0].id}/stock`)
      const data = await res.json()
      setStockData(data || [])
    } catch {
      setStockData([])
    }
  }

  const executeFulfill = async () => {
    if (!fulfillProduct) return
    setFulfilling(true)

    const transfers = Object.entries(transferQtys)
      .filter(([, qty]) => qty > 0)
      .map(([storeId, qty]) => ({ fromStoreId: storeId, qty }))

    try {
      // Process each request entry in the product group
      for (const entry of fulfillProduct.entries) {
        const totalToTransfer = transferQtys[entry.store_id] || 0
        // Distribute transfers proportionally
        let remaining = entry.quantity
        for (const t of transfers) {
          if (remaining <= 0) break
          const take = Math.min(remaining, t.qty)
          if (take > 0) {
            await fetch('/api/inventory/transfer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                product_id: fulfillProduct.id,
                from_store_id: t.fromStoreId,
                to_store_id: entry.store_id,
                quantity: take,
              }),
            })
            remaining -= take
          }
        }
        await fetch(`/api/inventory/requests/${entry.id}/fulfill`, { method: 'POST' })
      }

      setRequests(prev => prev.map(r =>
        fulfillProduct.entries.some(e => e.id === r.id) ? { ...r, status: 'fulfilled' } : r
      ))
      setFulfillProduct(null)
      setFulfilling(false)
      router.refresh()
    } catch {
      setFulfilling(false)
    }
  }

  const fulfillSingle = async (id: string) => {
    setLoading(id)
    await fetch(`/api/inventory/requests/${id}/fulfill`, { method: 'POST' })
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled' } : r))
    setLoading(null)
    router.refresh()
  }

  // Group pending requests by product
  const pendingGroups = useMemo(() => {
    const map: Record<string, { product_name: string; entries: Request[]; total: number }> = {}
    requests.filter(r => r.status === 'pending').forEach(r => {
      if (!map[r.product_id]) {
        map[r.product_id] = { product_name: r.product_name, entries: [], total: 0 }
      }
      map[r.product_id].entries.push(r)
      map[r.product_id].total += r.quantity
    })
    return Object.entries(map).map(([id, g]) => ({ product_id: id, ...g }))
  }, [requests])

  const pending = requests.filter(r => r.status === 'pending')
  const fulfilled = requests.filter(r => r.status === 'fulfilled')
  const confirmed = requests.filter(r => r.status === 'confirmed')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {pending.length} чакащи · {fulfilled.length} изпълнени{confirmed.length > 0 ? ` · ${confirmed.length} потвърдени` : ''}
        </p>
      </div>

      {pending.length === 0 && fulfilled.length === 0 && confirmed.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">
          <p>Няма заявки</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingGroups.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                Чакащи
                <Badge variant="destructive" className="text-[10px]">{pending.length}</Badge>
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium w-8" />
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-center px-4 py-3 font-medium">Общо</th>
                      <th className="text-center px-4 py-3 font-medium hidden sm:table-cell">Магазини</th>
                      <th className="text-right px-4 py-3 font-medium">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingGroups.map(g => {
                      const isExpanded = expandedProducts.has(g.product_id)
                      return (
                        <>
                          <tr key={g.product_id} className="border-b last:border-0 hover:bg-slate-50/50">
                            <td className="px-2">
                              <button onClick={() => toggleExpand(g.product_id)} className="p-1 hover:bg-slate-200 rounded">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">{g.product_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="font-bold tabular-nums text-base">{g.total}</span>
                              <span className="text-muted-foreground"> бр.</span>
                            </td>
                            <td className="px-4 py-3 text-center text-muted-foreground hidden sm:table-cell">
                              {g.entries.map(e => e.store_name).join(', ')}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openFulfill(g.product_id, g.product_name, g.entries, g.total)}
                              >
                                <ArrowRightLeft className="mr-1 h-3 w-3" />
                                Прехвърли
                              </Button>
                            </td>
                          </tr>
                          {isExpanded && g.entries.map(e => (
                            <tr key={e.id} className="border-b last:border-0 bg-slate-50/30">
                              <td />
                              <td className="px-4 py-2 pl-12 text-sm text-muted-foreground">
                                ↳ {e.store_name}
                              </td>
                              <td className="px-4 py-2 text-center tabular-nums font-medium">{e.quantity} бр.</td>
                              <td className="px-4 py-2 hidden sm:table-cell" />
                              <td className="px-4 py-2 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-green-600"
                                  onClick={() => fulfillSingle(e.id)}
                                  disabled={loading === e.id}
                                >
                                  {loading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fulfilled.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-muted-foreground">
                Изпълнени ({fulfilled.length})
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden opacity-60">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Магазин</th>
                      <th className="text-center px-4 py-3 font-medium">Кол.</th>
                      <th className="text-right px-4 py-3 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fulfilled.map(req => (
                      <tr key={req.id} className="border-b last:border-0">
                        <td className="px-4 py-3">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-[10px]">Изпратена</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {confirmed.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-muted-foreground">
                Потвърдени ({confirmed.length})
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden opacity-50">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Магазин</th>
                      <th className="text-center px-4 py-3 font-medium">Кол.</th>
                      <th className="text-right px-4 py-3 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmed.map(req => (
                      <tr key={req.id} className="border-b last:border-0">
                        <td className="px-4 py-3">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px]">Потвърдена</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fulfill Dialog */}
      {fulfillProduct && (
        <Dialog open={!!fulfillProduct} onOpenChange={() => setFulfillProduct(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                Прехвърляне: {fulfillProduct.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="bg-slate-50 rounded p-3 space-y-1">
                <p className="text-sm font-medium">Заявени общо: {fulfillProduct.totalQty} бр.</p>
                {fulfillProduct.entries.map(e => (
                  <p key={e.id} className="text-xs text-muted-foreground">
                    {e.store_name}: {e.quantity} бр.
                  </p>
                ))}
              </div>
              {stockData.length === 0 ? (
                <p className="text-sm text-muted-foreground">Зареждане на данни...</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-auto">
                  {stockData.map((s: any) => (
                    <div key={s.store_id} className="flex items-center gap-3 p-2 rounded border">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{s.store_name}</p>
                        <p className="text-xs text-muted-foreground">{s.qty} бр. налични</p>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        max={s.qty}
                        className="w-20 h-8 text-sm"
                        placeholder="0"
                        value={transferQtys[s.store_id] || ''}
                        onChange={e => setTransferQtys(prev => ({
                          ...prev,
                          [s.store_id]: parseInt(e.target.value) || 0,
                        }))}
                      />
                      <span className="text-xs text-muted-foreground">бр.</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setFulfillProduct(null)}>Отказ</Button>
                <Button onClick={executeFulfill} disabled={fulfilling}>
                  {fulfilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Прехвърли избраните
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
