'use client'

import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Send, Search, ShoppingCart, X, Plus, Minus, Package, Check } from 'lucide-react'

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
  const [cart, setCart] = useState<{ product: any; qty: number }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [history, setHistory] = useState<RequestHistory[]>([])
  const [showCart, setShowCart] = useState(false)

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
      for (const item of cart) {
        await fetch('/api/inventory/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: item.product.id, store_id: storeId, quantity: item.qty, notes: 'Групова заявка' }),
        })
      }
      setCart([])
      setShowCart(false)
      setToast(`Изпратени ${cart.length} заявки`)
      setTimeout(() => setToast(''), 3000)
      // Refresh history
      const res = await fetch('/api/inventory/requests')
      setHistory(await res.json())
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
    rejected: 'bg-red-100 text-red-800',
  }
  const STATUS_LABEL: Record<string, string> = {
    pending: 'Чакаща',
    fulfilled: 'Изпратена',
    confirmed: 'Потвърдена',
    rejected: 'Отказана',
  }

  const confirmReceipt = async (id: string) => {
    await fetch(`/api/inventory/requests/${id}/confirm`, { method: 'POST' })
    setHistory(prev => prev.map(h => h.id === id ? { ...h, status: 'confirmed' } : h))
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
                {history.map((h: any) => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{h.product_name}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{h.quantity}</td>
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
                        <Button size="sm" variant="outline" className="text-green-600" onClick={() => confirmReceipt(h.id)}>
                          <Check className="mr-1 h-3 w-3" />
                          Потвърди
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
