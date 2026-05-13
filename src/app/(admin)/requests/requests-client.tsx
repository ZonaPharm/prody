'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Loader2, ArrowRightLeft, Package, Store, ChevronDown, ChevronRight, MessageSquare, Clock, AlertTriangle, CheckCircle2, PlusCircle, Search, X, Send } from 'lucide-react'

interface Request {
  id: string
  product_id: string
  product_name: string
  store_id: string
  store_name: string
  requested_by?: string
  quantity: number
  status: string
  notes: string | null
  created_at: string
  accepted_at?: string
  in_transit_at?: string
  delivered_at?: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Чакаща',
  accepted: 'Приета',
  in_transit: 'На път',
  delivered: 'Доставена',
  fulfilled: 'Изпълнена',
  confirmed: 'Потвърдена',
  partial: 'Частична',
  rejected: 'Отказана',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  accepted: 'bg-sky-100 text-sky-800 border-sky-200',
  in_transit: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  delivered: 'bg-teal-100 text-teal-800 border-teal-200',
  fulfilled: 'bg-blue-100 text-blue-800 border-blue-200',
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  partial: 'bg-orange-100 text-orange-800 border-orange-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
}

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-amber-500',
  accepted: 'bg-sky-500',
  in_transit: 'bg-indigo-500',
  delivered: 'bg-teal-500',
  fulfilled: 'bg-blue-500',
  confirmed: 'bg-green-500',
  partial: 'bg-orange-500',
  rejected: 'bg-red-500',
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'току-що'
  if (mins < 60) return `преди ${mins} мин`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `преди ${hrs} ч`
  const days = Math.floor(hrs / 24)
  return `преди ${days} д`
}

function parseNotes(notes: string | null): { comment: string; received: number | null; timeline: string[] } {
  if (!notes) return { comment: '', received: null, timeline: [] }
  const recvMatch = notes.match(/\{\{received:(\d+)\}\}/)
  const received = recvMatch ? parseInt(recvMatch[1]) : null
  const clean = notes.replace(/\{\{received:\d+\}\}/, '').trim()
  const parts = clean.split(' | ').map(s => s.trim()).filter(Boolean)
  const statusWords = ['Изпълнена', 'Потвърдено', 'Получени', 'Заявката', 'Приета', 'Пратена', 'Доставена']
  const commentParts: string[] = []
  const timeline: string[] = []
  for (const p of parts) {
    if (statusWords.some(w => p.includes(w))) { timeline.push(p) }
    else { commentParts.push(p) }
  }
  return { comment: commentParts.join(' | '), received, timeline }
}

interface BatchEntry extends Request {}

interface Batch {
  key: string
  store_id: string
  store_name: string
  status: string
  comment: string
  created_at: string
  entries: BatchEntry[]
  totalQty: number
  productCount: number
}

export function RequestsClient({ requests: initialRequests, stores: initialStores, allProducts: initialProducts }: { requests: Request[], stores: any[], allProducts: any[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const stores = initialStores || []
  const allProducts = initialProducts || []

  // Sync state when server props change (after router.refresh)
  useEffect(() => {
    setRequests(initialRequests)
  }, [initialRequests])
  const [loading, setLoading] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)
  const [activeTab, setActiveTab] = useState('pending')
  const [fulfillStore, setFulfillStore] = useState<{ store_id: string; store_name: string; entries: Request[] } | null>(null)
  const [stockData, setStockData] = useState<Record<string, any[]>>({})
  const [transferQtys, setTransferQtys] = useState<Record<string, Record<string, number>>>({})
  const [fulfilling, setFulfilling] = useState(false)
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  const [detailReq, setDetailReq] = useState<Request | null>(null)
  const [requestEvents, setRequestEvents] = useState<any[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)

  // Create request dialog state
  const [showCreate, setShowCreate] = useState(false)
  const [createStoreId, setCreateStoreId] = useState('')
  const [createSearch, setCreateSearch] = useState('')
  const [createBasket, setCreateBasket] = useState<{ product: any; qty: number }[]>([])
  const [createLoading, setCreateLoading] = useState(false)

  const nonWarehouseStores = stores.filter((s: any) => !s.is_warehouse)

  const filteredCreateProducts = allProducts.filter((p: any) =>
    !createSearch || p.name.toLowerCase().includes(createSearch.toLowerCase())
  ).slice(0, 50)

  const addCreateItem = (product: any) => {
    setCreateBasket(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product, qty: 1 }]
    })
  }

  const submitCreateRequest = async () => {
    if (createBasket.length === 0 || !createStoreId) return
    setCreateLoading(true)
    try {
      const res = await fetch('/api/inventory/request-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: createStoreId,
          items: createBasket.map(i => ({ product_id: i.product.id, quantity: i.qty })),
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setCreateBasket([])
        setCreateStoreId('')
        setCreateSearch('')
        router.refresh()
      } else {
        const err = await res.json()
        alert(err.error || 'Грешка')
      }
    } catch { alert('Грешка при създаване') }
    setCreateLoading(false)
  }

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
        await fetch(`/api/inventory/requests/${entry.id}/ship`, { method: 'POST' })
      }
      setRequests(prev => prev.map(r =>
        fulfillStore.entries.some(e => e.id === r.id) ? { ...r, status: 'in_transit' } : r
      ))
      setFulfillStore(null)
    } catch { /* ignore */ }
    setFulfilling(false)
    router.refresh()
  }

  const handleAction = async (batch: Batch, action: string) => {
    let ok = true
    for (const entry of batch.entries) {
      setLoading(entry.id)
      const res = await fetch(`/api/inventory/requests/${entry.id}/${action}`, { method: 'POST' })
      if (!res.ok) ok = false
    }
    setLoading(null)
    if (ok) {
      const newStatus = action === 'accept' ? 'accepted' : action === 'deliver' ? 'delivered' : 'rejected'
      setRequests(prev => prev.map(r =>
        batch.entries.some(e => e.id === r.id) ? { ...r, status: newStatus } : r
      ))
      setSelectedBatch(null)
      router.refresh()
    } else {
      alert('Грешка при изпълнение на действието')
    }
  }

  const batches: Batch[] = useMemo(() => {
    const map: Record<string, Request[]> = {}
    requests.filter(r => r.status === 'pending').forEach(r => {
      const key = `${r.store_id}|${r.created_at?.substring(0, 19) || ''}|${r.notes || ''}`
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return Object.entries(map).map(([key, entries]) => {
      const [storeId] = key.split('|')
      const { comment } = parseNotes(entries[0].notes)
      return { key, store_id: storeId, store_name: entries[0].store_name, status: entries[0].status,
        comment, created_at: entries[0].created_at, entries, totalQty: entries.reduce((s, e) => s + e.quantity, 0),
        productCount: entries.length }
    }).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [requests])

  const inProgressBatches: Batch[] = useMemo(() => {
    const map: Record<string, Request[]> = {}
    requests.filter(r => ['accepted', 'in_transit', 'delivered'].includes(r.status)).forEach(r => {
      const key = `${r.store_id}|${r.created_at?.substring(0, 19) || ''}|${r.notes || ''}`
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return Object.entries(map).map(([key, entries]) => ({
      key, store_id: entries[0].store_id, store_name: entries[0].store_name, status: entries[0].status,
      comment: parseNotes(entries[0].notes).comment, created_at: entries[0].created_at, entries,
      totalQty: entries.reduce((s, e) => s + e.quantity, 0), productCount: entries.length,
    })).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [requests])

  const historyBatches: Batch[] = useMemo(() => {
    const map: Record<string, Request[]> = {}
    requests.filter(r => ['confirmed', 'partial', 'fulfilled', 'rejected'].includes(r.status)).forEach(r => {
      const key = `${r.store_id}|${r.created_at?.substring(0, 19) || ''}|${r.notes || ''}`
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return Object.entries(map).map(([key, entries]) => ({
      key, store_id: entries[0].store_id, store_name: entries[0].store_name, status: entries[0].status,
      comment: parseNotes(entries[0].notes).comment, created_at: entries[0].created_at, entries,
      totalQty: entries.reduce((s, e) => s + e.quantity, 0), productCount: entries.length,
    })).sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [requests])

  const filteredBatches = useMemo(() => {
    if (activeTab === 'pending') return batches
    if (activeTab === 'in_progress') return inProgressBatches
    return historyBatches
  }, [activeTab, batches, inProgressBatches, historyBatches])

  // Auto-select first batch when switching tabs
  useEffect(() => {
    if (filteredBatches.length > 0 && !filteredBatches.some(b => b.key === selectedBatch?.key)) {
      setSelectedBatch(filteredBatches[0])
    } else if (filteredBatches.length === 0) {
      setSelectedBatch(null)
    }
  }, [activeTab, filteredBatches])

  const pendingCount = requests.filter(r => r.status === 'pending').length
  const inProgressCount = requests.filter(r => ['accepted', 'in_transit', 'delivered'].includes(r.status)).length
  const doneCount = requests.filter(r => ['confirmed', 'partial', 'fulfilled', 'rejected'].includes(r.status)).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pendingCount} чакащи · {inProgressCount} в процес · {doneCount} приключени
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <PlusCircle className="mr-1.5 h-4 w-4" /> Нова заявка
        </Button>
      </div>

      {batches.length === 0 && historyBatches.length === 0 ? (
        <div className="rounded-xl border bg-white p-16 text-center">
          <Package className="mx-auto h-12 w-12 text-slate-200 mb-4" />
          <p className="text-muted-foreground text-lg">Няма заявки</p>
        </div>
      ) : (
        <div className="flex gap-4 h-[calc(100vh-12rem)]">
          {/* Left Panel — Batch List */}
          <div className="w-1/3 min-w-[300px] overflow-y-auto space-y-3 pr-2">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 sticky top-0 z-10">
              {(['pending', 'in_progress', 'done'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                    activeTab === tab ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {{ pending: 'Чакащи', in_progress: 'В процес', done: 'Приключени' }[tab]}
                  {tab === 'pending' && pendingCount > 0 && (
                    <span className="ml-1 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>
                  )}
                  {tab === 'in_progress' && inProgressCount > 0 && (
                    <span className="ml-1 bg-sky-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{inProgressCount}</span>
                  )}
                  {tab === 'done' && doneCount > 0 && (
                    <span className="ml-1 bg-slate-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{doneCount}</span>
                  )}
                </button>
              ))}
            </div>

            {filteredBatches.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">Няма заявки</p>
            ) : (
              filteredBatches.map(b => (
                <button key={b.key}
                  onClick={() => setSelectedBatch(b)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    selectedBatch?.key === b.key
                      ? 'ring-2 ring-blue-400 border-blue-300 bg-blue-50/50'
                      : 'bg-white hover:shadow-md border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="font-bold text-sm truncate">{b.store_name}</span>
                    <div className={`w-2 h-2 rounded-full ${STATUS_DOT[b.status]}`} />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COLOR[b.status]}`}>
                      {STATUS_LABEL[b.status]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{relativeTime(b.created_at)}</span>
                  </div>
                  {b.comment && (
                    <p className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                      <MessageSquare className="h-3 w-3 text-slate-400 shrink-0" />
                      <span className="truncate">{b.comment}</span>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{b.productCount} продукта · {b.totalQty} бр.</p>
                </button>
              ))
            )}
          </div>

          {/* Right Panel — Detail */}
          <div className="flex-1 overflow-y-auto min-w-0">
            {selectedBatch ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold">{selectedBatch.store_name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedBatch.productCount} продукта · {selectedBatch.totalQty} бр. · {relativeTime(selectedBatch.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {selectedBatch.status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => handleAction(selectedBatch, 'reject')}>
                          Откажи
                        </Button>
                        <Button size="sm" onClick={() => handleAction(selectedBatch, 'accept')}>
                          <Check className="mr-1 h-4 w-4" /> Приеми
                        </Button>
                      </>
                    )}
                    {selectedBatch.status === 'accepted' && (
                      <Button size="sm"
                        onClick={() => openFulfill(selectedBatch.store_id, selectedBatch.store_name, selectedBatch.entries)}>
                        <ArrowRightLeft className="mr-1 h-4 w-4" /> Прехвърли и изпрати
                      </Button>
                    )}
                    {selectedBatch.status === 'in_transit' && (
                      <Button size="sm" onClick={() => handleAction(selectedBatch, 'deliver')}>
                        <CheckCircle2 className="mr-1 h-4 w-4" /> Маркирай като доставена
                      </Button>
                    )}
                  </div>
                </div>

                {/* Products */}
                <div className="border rounded-xl divide-y">
                  {selectedBatch.entries.map(e => {
                    const { received, timeline } = parseNotes(e.notes)
                    const hasPartial = received !== null && received < e.quantity
                    return (
                      <div key={e.id} className="p-3 flex items-center justify-between hover:bg-slate-50/50 cursor-pointer"
                        onClick={() => openDetail(e)}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{e.product_name}</span>
                            {hasPartial ? (
                              <span className="text-xs font-bold text-orange-600 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {received}/{e.quantity} бр.
                              </span>
                            ) : e.status === 'confirmed' || e.status === 'fulfilled' ? (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            ) : null}
                          </div>
                          {timeline.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {timeline.map((t, i) => (
                                <span key={i} className="text-[10px] text-muted-foreground bg-slate-100 px-1.5 py-0.5 rounded">
                                  {t.length > 40 ? t.substring(0, 40) + '…' : t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-bold tabular-nums shrink-0 ml-4">{e.quantity} бр.</span>
                      </div>
                    )
                  })}
                </div>

                {/* RequestNotes */}
                <RequestNotes requestId={selectedBatch.entries[0]?.id} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Изберете заявка от списъка
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Dialog (events timeline) */}
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
              {(() => {
                const { received, timeline } = parseNotes(detailReq.notes)
                return (
                  <>
                    {received !== null && received < detailReq.quantity && (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                        <span className="text-sm text-orange-700">Получени {received} от {detailReq.quantity} бр.</span>
                      </div>
                    )}
                    {requestEvents.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">История</p>
                        <div className="space-y-0 relative pl-4 border-l-2 border-slate-200">
                          {requestEvents.map((evt: any, i: number) => {
                            const dotColor =
                              evt.status === 'pending' ? 'bg-amber-400' :
                              evt.status === 'accepted' ? 'bg-sky-400' :
                              evt.status === 'in_transit' ? 'bg-indigo-400' :
                              evt.status === 'delivered' ? 'bg-teal-400' :
                              evt.status === 'rejected' ? 'bg-red-400' :
                              evt.status === 'fulfilled' || evt.status === 'confirmed' ? 'bg-green-400' :
                              evt.status === 'partial' ? 'bg-orange-400' : 'bg-slate-400'
                            return (
                              <div key={i} className="relative pb-2">
                                <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white ${dotColor}`} />
                                <p className="text-xs text-muted-foreground">{new Date(evt.created_at).toLocaleString('bg-BG')}</p>
                                <p className="text-xs">{evt.notes}</p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
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
                  Прехвърли и изпрати
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Create Request Dialog */}
      {showCreate && (
        <Dialog open={showCreate} onOpenChange={() => { setShowCreate(false); setCreateBasket([]); setCreateSearch('') }}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Нова заявка</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-xs font-medium mb-1 block">Магазин</label>
                <select value={createStoreId} onChange={e => setCreateStoreId(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm">
                  <option value="">Изберете магазин</option>
                  {nonWarehouseStores.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Търсене на продукт..." value={createSearch}
                  onChange={e => setCreateSearch(e.target.value)} className="pl-9" />
              </div>
              {createSearch && (
                <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                  {filteredCreateProducts.map((p: any) => (
                    <div key={p.id} className="p-2 flex items-center justify-between hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.quantity_on_hand} бр.</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => addCreateItem(p)}>
                        <PlusCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {createBasket.length > 0 && (
                <div className="border rounded-lg p-3 space-y-2">
                  {createBasket.map(item => (
                    <div key={item.product.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{item.product.name}</span>
                      <Button variant="outline" size="icon" className="h-6 w-6"
                        onClick={() => setCreateBasket(prev => prev.map(i => i.product.id === item.product.id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))}>−</Button>
                      <span className="w-6 text-center tabular-nums">{item.qty}</span>
                      <Button variant="outline" size="icon" className="h-6 w-6"
                        onClick={() => setCreateBasket(prev => prev.map(i => i.product.id === item.product.id ? { ...i, qty: i.qty + 1 } : i))}>+</Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500"
                        onClick={() => setCreateBasket(prev => prev.filter(i => i.product.id !== item.product.id))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={() => { setShowCreate(false); setCreateBasket([]); setCreateSearch('') }}>Отказ</Button>
                <Button onClick={submitCreateRequest} disabled={createLoading || createBasket.length === 0 || !createStoreId}>
                  {createLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Създай заявка
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Inline RequestNotes component
function RequestNotes({ requestId }: { requestId: string }) {
  const [notes, setNotes] = useState<any[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!requestId) return
    fetch(`/api/inventory/requests/${requestId}/notes`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setNotes(d) })
      .catch(() => {})
  }, [requestId])

  const send = async () => {
    if (!text.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/inventory/requests/${requestId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
      if (res.ok) {
        const note = await res.json()
        setNotes(prev => [...prev, note])
        setText('')
      }
    } catch { /* ignore */ }
    setSending(false)
  }

  return (
    <div className="border rounded-xl p-4">
      <h3 className="text-sm font-medium mb-3">Коментари</h3>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-3">Няма коментари</p>
      ) : (
        <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
          {notes.map((n: any) => (
            <div key={n.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-xs">{n.user_name || '—'}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(n.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="mt-0.5 text-sm">{n.body}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={text} onChange={e => setText(e.target.value)}
          placeholder="Напишете коментар..." className="h-8 text-sm"
          onKeyDown={e => { if (e.key === 'Enter') send() }} />
        <Button size="sm" onClick={send} disabled={sending || !text.trim()}>Изпрати</Button>
      </div>
    </div>
  )
}
