'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Loader2, ArrowRightLeft, Package, Store, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'

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

const STATUS_LABEL: Record<string, string> = {
  pending: 'Чакаща',
  fulfilled: 'Изпратена',
  confirmed: 'Потвърдена',
  partial: 'Частична',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  fulfilled: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  partial: 'bg-amber-100 text-amber-800',
}

export function RequestsClient({ requests: initialRequests }: { requests: Request[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [loading, setLoading] = useState<string | null>(null)
  const [fulfillStore, setFulfillStore] = useState<{ store_id: string; store_name: string; entries: Request[] } | null>(null)
  const [stockData, setStockData] = useState<Record<string, any[]>>({})
  const [transferQtys, setTransferQtys] = useState<Record<string, Record<string, number>>>({})
  const [fulfilling, setFulfilling] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<Request[] | null>(null)
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  const [detailReq, setDetailReq] = useState<Request | null>(null)
  const [requestEvents, setRequestEvents] = useState<any[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)

  const toggleBatch = (key: string) => {
    setExpandedBatches(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openDetail = async (req: Request) => {
    setDetailReq(req)
    setLoadingEvents(true)
    try {
      const res = await fetch(`/api/inventory/requests/${req.id}/events`)
      setRequestEvents(await res.json())
    } catch { setRequestEvents([]) }
    setLoadingEvents(false)
  }

  const openFulfill = async (storeId: string, storeName: string, entries: Request[]) => {
    setFulfillStore({ store_id: storeId, store_name: storeName, entries })
    setTransferQtys({})
    const stockMap: Record<string, any[]> = {}
    for (const e of entries) {
      try {
        const res = await fetch(`/api/inventory/requests/${e.id}/stock`)
        stockMap[e.product_id] = await res.json()
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
        const transfers = Object.entries(productTransfers).filter(([, qty]) => qty > 0)
        for (const [fromId, qty] of transfers) {
          if (qty <= 0) continue
          await fetch('/api/inventory/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: entry.product_id, from_store_id: fromId, to_store_id: fulfillStore.store_id, quantity: qty }),
          })
        }
        await fetch(`/api/inventory/requests/${entry.id}/fulfill`, { method: 'POST' })
      }
      setRequests(prev => prev.map(r =>
        fulfillStore.entries.some(e => e.id === r.id) ? { ...r, status: 'fulfilled' } : r
      ))
      setFulfillStore(null)
    } catch { /* ignore */ }
    setFulfilling(false)
    router.refresh()
  }

  const fulfillSingle = async (id: string) => {
    setLoading(id)
    await fetch(`/api/inventory/requests/${id}/fulfill`, { method: 'POST' })
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled' } : r))
    setLoading(null)
    router.refresh()
  }

  // Group by batch: same store + same created_at second + same notes = one request batch
  const batches = useMemo(() => {
    // First pass: group by (store_id, created_at.substring(0,19)) — same second
    const map: Record<string, Request[]> = {}
    requests.filter(r => r.status === 'pending').forEach(r => {
      const key = `${r.store_id}|${r.created_at?.substring(0, 19) || ''}|${r.notes || ''}`
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return Object.entries(map).map(([key, entries]) => {
      const [storeId, , ] = key.split('|')
      return {
        key,
        store_id: storeId,
        store_name: entries[0].store_name,
        status: entries[0].status,
        notes: entries[0].notes,
        created_at: entries[0].created_at,
        entries,
        totalQty: entries.reduce((s, e) => s + e.quantity, 0),
        productCount: entries.length,
      }
    }).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [requests])

  // Non-pending batches for history
  const historyBatches = useMemo(() => {
    const map: Record<string, Request[]> = {}
    requests.filter(r => r.status !== 'pending').forEach(r => {
      const key = `${r.store_id}|${r.created_at?.substring(0, 19) || ''}|${r.notes || ''}`
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return Object.entries(map).map(([key, entries]) => ({
      key,
      store_name: entries[0].store_name,
      status: entries[0].status,
      notes: entries[0].notes,
      created_at: entries[0].created_at,
      entries,
      totalQty: entries.reduce((s, e) => s + e.quantity, 0),
    })).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [requests])

  const pendingCount = requests.filter(r => r.status === 'pending').length
  const doneCount = requests.filter(r => r.status !== 'pending').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {batches.length} чакащи · {historyBatches.length} обработени
        </p>
      </div>

      {batches.length === 0 && historyBatches.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">Няма заявки</div>
      ) : (
        <div className="space-y-6">
          {/* Pending batches */}
          {batches.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                Чакащи <Badge variant="destructive" className="text-[10px]">{pendingCount} артикула</Badge>
              </h2>
              <div className="space-y-3">
                {batches.map(b => {
                  const isExpanded = expandedBatches.has(b.key)
                  return (
                    <div key={b.key} className="rounded-lg border bg-white overflow-hidden">
                      {/* Main row */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                        onClick={() => toggleBatch(b.key)}
                      >
                        <button className="shrink-0 p-0.5 hover:bg-slate-200 rounded">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <Store className="h-4 w-4 text-slate-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{b.store_name}</span>
                            <Badge variant="secondary" className={`text-[10px] ${STATUS_COLOR.pending}`}>
                              {STATUS_LABEL.pending}
                            </Badge>
                          </div>
                          {b.notes && (
                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" /> {b.notes}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-bold tabular-nums">{b.totalQty}</span>
                          <span className="text-xs text-muted-foreground"> бр.</span>
                          <span className="text-xs text-muted-foreground ml-1">({b.productCount})</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={e => { e.stopPropagation(); openFulfill(b.store_id, b.store_name, b.entries) }}
                        >
                          <ArrowRightLeft className="mr-1 h-3 w-3" />
                          Прехвърли
                        </Button>
                      </div>

                      {/* Expanded products */}
                      {isExpanded && (
                        <div className="border-t bg-slate-50/30 divide-y">
                          {b.entries.map(e => (
                            <div key={e.id} className="px-4 py-2 pl-12 flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="truncate">{e.product_name}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="tabular-nums font-medium">{e.quantity} бр.</span>
                                <Button size="sm" variant="ghost" className="text-green-600 h-7 w-7 p-0"
                                  onClick={() => fulfillSingle(e.id)} disabled={loading === e.id}>
                                  {loading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* History batches */}
          {historyBatches.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-muted-foreground">
                Обработени ({doneCount} артикула)
              </h2>
              <div className="space-y-3">
                {historyBatches.map(b => {
                  const isExpanded = expandedBatches.has(b.key)
                  return (
                    <div key={b.key} className="rounded-lg border bg-white overflow-hidden opacity-75">
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                        onClick={() => toggleBatch(b.key)}>
                        <button className="shrink-0 p-0.5 hover:bg-slate-200 rounded">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <Store className="h-4 w-4 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{b.store_name}</span>
                            <Badge variant="secondary" className={`text-[10px] ${STATUS_COLOR[b.status] || ''}`}>
                              {STATUS_LABEL[b.status] || b.status}
                            </Badge>
                          </div>
                          {b.notes && (
                            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" /> {b.notes}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(b.created_at).toLocaleString('bg-BG')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-bold tabular-nums">{b.totalQty}</span>
                          <span className="text-xs text-muted-foreground"> бр.</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t bg-slate-50/30 divide-y">
                          {b.entries.map(e => (
                            <div key={e.id} className="px-4 py-2 pl-12 flex items-center justify-between text-sm cursor-pointer hover:bg-slate-100"
                              onClick={() => openDetail(e)}>
                              <div className="flex items-center gap-2 min-w-0">
                                <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                                <span className="truncate">{e.product_name}</span>
                              </div>
                              <span className="tabular-nums shrink-0">{e.quantity} бр.</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail Dialog */}
      {detailReq && (
        <Dialog open={!!detailReq} onOpenChange={() => { setDetailReq(null); setRequestEvents([]) }}>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>{detailReq.product_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-muted-foreground">Заявени</p><p className="font-bold">{detailReq.quantity} бр.</p></div>
                <div><p className="text-muted-foreground">Магазин</p><p className="font-medium">{detailReq.store_name}</p></div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Проследимост</p>
                {loadingEvents ? <p className="text-xs text-muted-foreground">Зареждане...</p>
                : requestEvents.length === 0 ? <p className="text-xs text-muted-foreground">Няма данни</p>
                : (
                  <div className="space-y-0 relative pl-4 border-l-2 border-slate-200">
                    {requestEvents.map((evt: any, i: number) => (
                      <div key={i} className="relative pb-3 last:pb-0">
                        <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white ${
                          evt.status === 'pending' ? 'bg-yellow-400' : evt.status === 'fulfilled' ? 'bg-blue-500' :
                          evt.status === 'confirmed' ? 'bg-green-500' : evt.status === 'partial' ? 'bg-amber-500' : 'bg-slate-400'
                        }`} />
                        <p className="text-xs font-medium">{STATUS_LABEL[evt.status] || evt.status}</p>
                        <p className="text-xs text-muted-foreground">{evt.notes}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(evt.created_at).toLocaleString('bg-BG')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Fulfill Dialog */}
      {fulfillStore && (
        <Dialog open={!!fulfillStore} onOpenChange={() => setFulfillStore(null)}>
          <DialogContent className="sm:max-w-[550px]">
            <DialogHeader>
              <DialogTitle>Прехвърляне към: {fulfillStore.store_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="bg-slate-50 rounded p-3 space-y-1">
                <p className="text-sm font-medium">Заявени продукти:</p>
                {fulfillStore.entries.map(e => (
                  <p key={e.id} className="text-xs text-muted-foreground">{e.product_name}: {e.quantity} бр.</p>
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
                            <Input type="number" min="0" max={s.qty} className="w-16 h-7 text-xs" placeholder="0"
                              value={productTransfers[s.store_id] || ''}
                              onChange={ev => setTransferQtys(prev => ({
                                ...prev,
                                [e.product_id]: { ...(prev[e.product_id] || {}), [s.store_id]: parseInt(ev.target.value) || 0 },
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
