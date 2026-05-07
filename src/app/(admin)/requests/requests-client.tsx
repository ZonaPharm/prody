'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Loader2, ArrowRightLeft, Package, Store } from 'lucide-react'

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
  const [fulfillStore, setFulfillStore] = useState<{ store_id: string; store_name: string; entries: Request[] } | null>(null)
  const [stockData, setStockData] = useState<Record<string, any[]>>({})
  const [transferQtys, setTransferQtys] = useState<Record<string, Record<string, number>>>({})
  const [fulfilling, setFulfilling] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null)
  const [requestEvents, setRequestEvents] = useState<any[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)

  const openDetail = async (req: Request) => {
    setSelectedRequest(req)
    setLoadingEvents(true)
    try {
      const res = await fetch(`/api/inventory/requests/${req.id}/events`)
      setRequestEvents(await res.json())
    } catch { setRequestEvents([]) }
    setLoadingEvents(false)
  }

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Чакаща',
    fulfilled: 'Изпратена',
    confirmed: 'Потвърдена',
    partial: 'Частична',
  }

  const openFulfill = async (storeId: string, storeName: string, entries: Request[]) => {
    setFulfillStore({ store_id: storeId, store_name: storeName, entries })
    setTransferQtys({})

    // Fetch stock for each unique product
    const stockMap: Record<string, any[]> = {}
    for (const e of entries) {
      try {
        const res = await fetch(`/api/inventory/requests/${e.id}/stock`)
        const data = await res.json()
        stockMap[e.product_id] = data || []
      } catch { stockMap[e.product_id] = [] }
    }
    setStockData(stockMap)
  }

  const executeFulfill = async () => {
    if (!fulfillStore) return
    setFulfilling(true)

    try {
      for (const entry of fulfillStore.entries) {
        const productTransfers = transferQtys[entry.product_id] || {}
        const transfers = Object.entries(productTransfers)
          .filter(([, qty]) => qty > 0)
          .map(([storeId, qty]) => ({ fromStoreId: storeId, qty }))

        for (const t of transfers) {
          if (t.qty <= 0) continue
          await fetch('/api/inventory/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id: entry.product_id,
              from_store_id: t.fromStoreId,
              to_store_id: fulfillStore.store_id,
              quantity: t.qty,
            }),
          })
        }
        await fetch(`/api/inventory/requests/${entry.id}/fulfill`, { method: 'POST' })
      }

      setRequests(prev => prev.map(r =>
        fulfillStore.entries.some(e => e.id === r.id) ? { ...r, status: 'fulfilled' } : r
      ))
      setFulfillStore(null)
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

  // Group pending requests by store
  const storeGroups = useMemo(() => {
    const map: Record<string, { store_name: string; entries: Request[]; totalQty: number; productCount: number }> = {}
    requests.filter(r => r.status === 'pending').forEach(r => {
      if (!map[r.store_id]) {
        map[r.store_id] = { store_name: r.store_name, entries: [], totalQty: 0, productCount: 0 }
      }
      map[r.store_id].entries.push(r)
      map[r.store_id].totalQty += r.quantity
      map[r.store_id].productCount++
    })
    return Object.entries(map).map(([id, g]) => ({ store_id: id, ...g }))
  }, [requests])

  const pending = requests.filter(r => r.status === 'pending')
  const fulfilled = requests.filter(r => r.status === 'fulfilled')
  const confirmed = requests.filter(r => r.status === 'confirmed' || r.status === 'partial')

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
          {storeGroups.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                Чакащи
                <Badge variant="destructive" className="text-[10px]">{pending.length}</Badge>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {storeGroups.map(g => (
                  <div key={g.store_id} className="rounded-lg border bg-white overflow-hidden">
                    <div className="bg-slate-50 border-b px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-slate-500" />
                        <span className="font-semibold text-sm">{g.store_name}</span>
                        <Badge variant="secondary" className="text-[10px]">{g.productCount} продукта</Badge>
                      </div>
                      <span className="text-sm font-bold tabular-nums">{g.totalQty} бр.</span>
                    </div>
                    <div className="divide-y">
                      {g.entries.map(e => (
                        <div key={e.id} className="px-4 py-2 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{e.product_name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="tabular-nums font-medium">{e.quantity} бр.</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-green-600 h-7 w-7 p-0"
                              onClick={() => fulfillSingle(e.id)}
                              disabled={loading === e.id}
                            >
                              {loading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t px-4 py-2 bg-slate-50/50">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => openFulfill(g.store_id, g.store_name, g.entries)}
                      >
                        <ArrowRightLeft className="mr-1 h-3 w-3" />
                        Прехвърли всички
                      </Button>
                    </div>
                  </div>
                ))}
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
                      <tr key={req.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(req)}>
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
                      <tr key={req.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(req)}>
                        <td className="px-4 py-3">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className={`text-[10px] ${req.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                            {req.status === 'partial' ? 'Частична' : 'Потвърдена'}
                          </Badge>
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

      {/* Request Detail Dialog */}
      {selectedRequest && (
        <Dialog open={!!selectedRequest} onOpenChange={() => { setSelectedRequest(null); setRequestEvents([]) }}>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>{selectedRequest.product_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Заявени</p>
                  <p className="font-bold">{selectedRequest.quantity} бр.</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Магазин</p>
                  <p className="font-medium">{selectedRequest.store_name}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Проследимост</p>
                {loadingEvents ? (
                  <p className="text-xs text-muted-foreground">Зареждане...</p>
                ) : requestEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Няма данни</p>
                ) : (
                  <div className="space-y-0 relative pl-4 border-l-2 border-slate-200">
                    {requestEvents.map((evt: any, i: number) => (
                      <div key={i} className="relative pb-3 last:pb-0">
                        <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                          evt.status === 'pending' ? 'bg-yellow-400' :
                          evt.status === 'fulfilled' ? 'bg-blue-500' :
                          evt.status === 'confirmed' ? 'bg-green-500' :
                          evt.status === 'partial' ? 'bg-amber-500' : 'bg-slate-400'
                        }`} />
                        <p className="text-xs font-medium">{STATUS_LABEL[evt.status] || evt.status}</p>
                        <p className="text-xs text-muted-foreground">{evt.notes}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(evt.created_at).toLocaleString('bg-BG')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Fulfill Dialog — per store */}
      {fulfillStore && (
        <Dialog open={!!fulfillStore} onOpenChange={() => setFulfillStore(null)}>
          <DialogContent className="sm:max-w-[550px]">
            <DialogHeader>
              <DialogTitle>
                Прехвърляне към: {fulfillStore.store_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="bg-slate-50 rounded p-3 space-y-1">
                <p className="text-sm font-medium">Заявени продукти:</p>
                {fulfillStore.entries.map(e => (
                  <p key={e.id} className="text-xs text-muted-foreground">
                    {e.product_name}: {e.quantity} бр.
                  </p>
                ))}
              </div>

              {fulfillStore.entries.map(e => {
                const productStock = stockData[e.product_id] || []
                const productTransfers = transferQtys[e.product_id] || {}
                return (
                  <div key={e.product_id} className="border rounded p-3 space-y-2">
                    <p className="text-sm font-medium">{e.product_name} (заявени: {e.quantity} бр.)</p>
                    {productStock.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Няма наличност</p>
                    ) : (
                      <div className="space-y-1">
                        {productStock.map((s: any) => (
                          <div key={s.store_id} className="flex items-center gap-2">
                            <span className="text-xs flex-1 truncate">{s.store_name} ({s.qty} бр.)</span>
                            <Input
                              type="number"
                              min="0"
                              max={s.qty}
                              className="w-16 h-7 text-xs"
                              placeholder="0"
                              value={productTransfers[s.store_id] || ''}
                              onChange={ev => setTransferQtys(prev => ({
                                ...prev,
                                [e.product_id]: {
                                  ...(prev[e.product_id] || {}),
                                  [s.store_id]: parseInt(ev.target.value) || 0,
                                },
                              }))}
                            />
                            <span className="text-xs text-muted-foreground">бр.</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setFulfillStore(null)}>Отказ</Button>
                <Button onClick={executeFulfill} disabled={fulfilling}>
                  {fulfilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Прехвърли
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
