'use client'

import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, Send, Search, ShoppingCart, X, Plus, Minus, Package, Check, Loader2, MessageSquare, AlertOctagon } from 'lucide-react'

interface ProductItem {
  id: string
  name: string
  price: number | null
  category: string | null
  min_quantity: number
  current_qty: number
}

interface RequestHistory {
  id: string
  product_name: string
  quantity: number
  status: string
  created_at: string
}

export function LowStockClient({
  items,
  storeId,
  allProducts,
  imageMap,
}: {
  items: ProductItem[]
  storeId: string
  allProducts: { id: string; name: string; price: number | null; category: { name: string } | null }[]
  imageMap: Record<string, string>
}) {
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<{ product: any; qty: number; notes?: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [history, setHistory] = useState<RequestHistory[]>([])
  const [showCart, setShowCart] = useState(false)
  const [cartNotes, setCartNotes] = useState('')
  const [confirmReq, setConfirmReq] = useState<RequestHistory | null>(null)
  const [confirmQty, setConfirmQty] = useState(0)
  const [confirmNotes, setConfirmNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<RequestHistory | null>(null)
  const [requestEvents, setRequestEvents] = useState<any[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)

  const openDetail = async (req: RequestHistory) => {
    setSelectedRequest(req)
    setLoadingEvents(true)
    try {
      const res = await fetch(`/api/inventory/requests/${req.id}/events`)
      setRequestEvents(await res.json())
    } catch { setRequestEvents([]) }
    setLoadingEvents(false)
  }

  useEffect(() => {
    fetch(`/api/inventory/requests`)
      .then(r => r.json())
      .then(setHistory)
  }, [storeId])

  const addToCart = (product: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product, qty: 1 }]
    })
  }

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  const setCartQty = (productId: string, qty: number) => {
    if (qty <= 0) { removeFromCart(productId); return }
    setCart(prev => prev.map(i => i.product.id === productId ? { ...i, qty } : i))
  }

  const submitAll = async () => {
    if (cart.length === 0) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/inventory/request-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          notes: cartNotes || null,
          items: cart.map(item => ({ product_id: item.product.id, quantity: item.qty })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Грешка')
      }
      setCart([])
      setShowCart(false)
      setToast(`Изпратени ${cart.length} заявки`)
      setTimeout(() => setToast(''), 3000)
      // Refresh history
      const hRes = await fetch('/api/inventory/requests')
      setHistory(await hRes.json())
    } finally {
      setSubmitting(false)
    }
  }

  const filteredProducts = useMemo(() => {
    if (!search || search.length < 2) return []
    const q = search.toLowerCase()
    return (allProducts || []).filter((p: any) => {
      const name = (p.name || '').toLowerCase()
      let cat = ''
      const c = p.category
      if (c) {
        if (Array.isArray(c)) cat = (c[0]?.name || '').toLowerCase()
        else if (typeof c === 'object') cat = (c.name || '').toLowerCase()
      }
      return name.includes(q) || cat.includes(q)
    }).slice(0, 20)
  }, [search, allProducts])

  const STATUS_BADGE: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    fulfilled: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-green-100 text-green-800',
    partial: 'bg-amber-100 text-amber-800',
    rejected: 'bg-red-100 text-red-800',
  }
  const STATUS_LABEL: Record<string, string> = {
    pending: 'Чакаща',
    fulfilled: 'Изпратена',
    confirmed: 'Потвърдена',
    partial: 'Частична',
    rejected: 'Отказана',
  }

  const confirmReceipt = async () => {
    if (!confirmReq) return
    setConfirming(true)
    const body = confirmQty < confirmReq.quantity
      ? JSON.stringify({ received_qty: confirmQty, notes: confirmNotes || `Получени ${confirmQty} от ${confirmReq.quantity} бр.` })
      : JSON.stringify({ received_qty: confirmReq.quantity, notes: confirmNotes || null })
    const res = await fetch(`/api/inventory/requests/${confirmReq.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const data = await res.json()
    setHistory(prev => prev.map(h => h.id === confirmReq.id ? { ...h, status: data.status } : h))
    setConfirmReq(null)
    setConfirmNotes('')
    setConfirming(false)
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Заявки</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Заявете необходимите ви количества
          </p>
        </div>
        {cart.length > 0 && (
          <Button onClick={() => setShowCart(!showCart)} variant={showCart ? 'default' : 'outline'}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Кошница ({cart.length})
          </Button>
        )}
      </div>

      {/* Cart panel */}
      {showCart && cart.length > 0 && (
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h3 className="font-semibold text-sm">Кошница със заявки</h3>
          {cart.map(item => (
            <div key={item.product.id} className="flex items-center gap-3 py-2 border-b last:border-0">
              <div className="h-10 w-10 rounded bg-slate-100 shrink-0 overflow-hidden">
                {imageMap[item.product.id] ? (
                  <img src={imageMap[item.product.id]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-5 w-5 m-2.5 text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.product.name}</p>
                {item.product.price && (
                  <p className="text-xs text-muted-foreground">{item.product.price.toFixed(2)} €</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCartQty(item.product.id, item.qty - 1)}>
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-8 text-center text-sm tabular-nums">{item.qty}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCartQty(item.product.id, item.qty + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeFromCart(item.product.id)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="space-y-1.5 px-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Коментар към заявката (по желание)
            </p>
            <Input
              placeholder="Напр. Трябват за уикенда..."
              value={cartNotes}
              onChange={e => setCartNotes(e.target.value)}
              className="h-10 text-sm"
            />
          </div>
          <Button className="w-full" onClick={submitAll} disabled={submitting}>
            <Send className="mr-2 h-4 w-4" />
            {submitting ? 'Изпращане...' : `Изпрати ${cart.length} заявки`}
          </Button>
        </div>
      )}

      {/* Search */}
      <div className="rounded-lg border bg-white p-4">
        <p className="text-sm font-medium mb-3">Добави продукт към заявка</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Търсене на продукт..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {filteredProducts.length > 0 && (
          <div className="mt-3 border rounded-md divide-y max-h-[300px] overflow-auto">
            {filteredProducts.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 p-2 hover:bg-slate-50">
                <div className="h-10 w-10 rounded bg-slate-100 shrink-0 overflow-hidden">
                  {imageMap[p.id] ? (
                    <img src={imageMap[p.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-5 w-5 m-2.5 text-slate-300" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => addToCart(p)}>
                  <Plus className="mr-1 h-3 w-3" /> Добави
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Low stock alerts */}
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Ниски наличности
          {items.length > 0 && <span className="text-xs font-normal text-muted-foreground">({items.length})</span>}
        </h2>
        {items.length > 0 && (
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Продукт</th>
                  <th className="text-center px-4 py-3 font-medium">Налични</th>
                  <th className="text-center px-4 py-3 font-medium hidden sm:table-cell">Мин.</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded bg-slate-100 shrink-0 overflow-hidden">
                          {imageMap[item.id] ? (
                            <img src={imageMap[item.id]} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Package className="h-5 w-5 m-2.5 text-slate-300" />
                          )}
                        </div>
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold tabular-nums ${item.current_qty === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {item.current_qty}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground hidden sm:table-cell tabular-nums">{item.min_quantity}</td>
                    <td className="px-2">
                      <Button size="sm" variant="ghost" onClick={() => addToCart(item)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Request history */}
      <div>
        <h2 className="text-base font-semibold mb-3">История на заявките</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Няма направени заявки</p>
        ) : (
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Продукт</th>
                  <th className="text-center px-4 py-3 font-medium">Кол.</th>
                  <th className="text-center px-4 py-3 font-medium">Статус</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Дата</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {history.map((h: any) => {
                    const recvMatch = (h.notes || '').match(/\{\{received:(\d+)\}\}/)
                    const receivedQty = recvMatch ? parseInt(recvMatch[1]) : null
                    const isPartial = h.status === 'partial' || (receivedQty !== null && receivedQty < h.quantity)
                    return (
                  <tr key={h.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => openDetail(h)}>
                    <td className="px-4 py-3 font-medium">{h.product_name}</td>
                    <td className="px-4 py-3 text-center">
                      {isPartial ? (
                        <span className="text-orange-600 font-bold tabular-nums flex items-center justify-center gap-1">
                          <AlertOctagon className="h-3 w-3" />
                          {receivedQty}/{h.quantity}
                        </span>
                      ) : h.status === 'confirmed' ? (
                        <span className="text-green-600 font-bold tabular-nums">{h.quantity} ✓</span>
                      ) : (
                        <span className="tabular-nums">{h.quantity}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="secondary" className={`text-[10px] ${STATUS_BADGE[h.status] || ''}`}>
                        {STATUS_LABEL[h.status] || h.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                      {new Date(h.created_at).toLocaleDateString('bg-BG')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {h.status === 'fulfilled' && (
                        <Button size="sm" variant="outline" className="text-green-600" onClick={(e) => { e.stopPropagation(); setConfirmReq(h); setConfirmQty(h.quantity) }}>
                          <Check className="mr-1 h-3 w-3" />
                          Потвърди
                        </Button>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                  <p className="text-muted-foreground">Статус</p>
                  <Badge variant="secondary" className={`text-[10px] ${STATUS_BADGE[selectedRequest.status] || ''}`}>
                    {STATUS_LABEL[selectedRequest.status] || selectedRequest.status}
                  </Badge>
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

      {/* Confirm Receipt Dialog */}
      {confirmReq && (
        <Dialog open={!!confirmReq} onOpenChange={() => setConfirmReq(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Потвърждаване на доставка</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="bg-slate-50 rounded p-3 space-y-1">
                <p className="text-sm font-medium">{confirmReq.product_name}</p>
                <p className="text-xs text-muted-foreground">Заявени: {confirmReq.quantity} бр.</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Получено количество</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setConfirmQty(Math.max(0, confirmQty - 1))}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Input
                    type="number"
                    min="0"
                    className="w-20 text-center"
                    value={confirmQty}
                    onChange={e => setConfirmQty(parseInt(e.target.value) || 0)}
                  />
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setConfirmQty(confirmQty + 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmQty(confirmReq.quantity)}>
                    Всички
                  </Button>
                </div>
                {confirmQty < confirmReq.quantity && (
                  <p className="text-xs text-amber-600">Ще бъде отбелязано като частично ({confirmQty} от {confirmReq.quantity} бр.)</p>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  Коментар (по желание)
                </p>
                <Input
                  placeholder="Напр. липсват 2 броя, ще дойдат утре"
                  value={confirmNotes}
                  onChange={e => setConfirmNotes(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setConfirmReq(null)}>Отказ</Button>
                <Button onClick={confirmReceipt} disabled={confirming}>
                  {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Потвърди
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
