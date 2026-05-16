'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Plus, X, Send, CheckCircle2, Loader2, AlertTriangle, Package } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { sofiaTime, sofiaDate } from '@/lib/date-utils'

interface Product {
  id: string; name: string; price: number | null; quantity_on_hand: number; category_id?: string | null
}

interface MyRequest {
  id: string; product_name: string; quantity: number
  status: string; notes: string | null; created_at: string
  accepted_at?: string; in_transit_at?: string; delivered_at?: string
}

interface LowStockItem {
  id: string; name: string; price: number | null
  category: string | null; min_quantity: number; current_qty: number
}

interface Props {
  products: Product[]
  categories: { id: string; name: string }[]
  imageMap: Record<string, string>
  myRequests: MyRequest[]
  activeTab: string
  storeId: string | null | undefined
  lowStockItems: LowStockItem[]
  lowStockAllProducts: any[]
  lowStockImageMap: Record<string, string>
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Чакаща', accepted: 'Приета', in_transit: 'На път',
  delivered: 'Доставена', fulfilled: 'Изпълнена',
  confirmed: 'Потвърдена', partial: 'Частична', rejected: 'Отказана',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800', accepted: 'bg-sky-100 text-sky-800',
  in_transit: 'bg-indigo-100 text-indigo-800', delivered: 'bg-teal-100 text-teal-800',
  fulfilled: 'bg-blue-100 text-blue-800', confirmed: 'bg-green-100 text-green-800',
  partial: 'bg-orange-100 text-orange-800', rejected: 'bg-red-100 text-red-800',
}

const TABS = [
  { key: 'request', label: 'Заяви' },
  { key: 'my', label: 'Моите заявки' },
  { key: 'low', label: 'Ниски наличности' },
]

export function MyRequestsClient({ products, categories, imageMap, myRequests, activeTab, storeId, lowStockItems, lowStockAllProducts, lowStockImageMap }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [tab, setTab] = useState(activeTab)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [basket, setBasket] = useState<{ product: Product; qty: number }[]>([])
  const [sending, setSending] = useState(false)

  const switchTab = (t: string) => {
    setTab(t)
    router.push(`/my-requests?tab=${t}`)
  }

  const filteredProducts = products.filter(p => {
    if (selectedCategory && p.category_id !== selectedCategory) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).sort((a, b) => (a.quantity_on_hand || 0) - (b.quantity_on_hand || 0)).slice(0, 100)

  const addToBasket = (product: Product) => {
    setBasket(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product, qty: 1 }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) { setBasket(prev => prev.filter(i => i.product.id !== productId)); return }
    setBasket(prev => prev.map(i => i.product.id === productId ? { ...i, qty } : i))
  }

  const removeFromBasket = (productId: string) => {
    setBasket(prev => prev.filter(i => i.product.id !== productId))
  }

  const sendRequest = async () => {
    if (basket.length === 0) return
    if (!storeId) { toast({ title: 'Нямате зададен магазин', variant: 'destructive' }); return }
    setSending(true)
    try {
      const res = await fetch('/api/inventory/request-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          items: basket.map(i => ({ product_id: i.product.id, quantity: i.qty })),
        }),
      })
      if (res.ok) {
        setBasket([])
        setSearch('')
        toast({ title: 'Заявката е изпратена' })
        router.refresh()
      } else {
        const err = await res.json()
        toast({ title: err.error || 'Грешка', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Грешка при изпращане', variant: 'destructive' })
    } finally { setSending(false) }
  }

  const confirmReceipt = async (id: string, qty: number) => {
    try {
      const res = await fetch(`/api/inventory/requests/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received_qty: qty }),
      })
      if (res.ok) {
        toast({ title: 'Получаването е потвърдено' })
        router.refresh()
      }
    } catch { toast({ title: 'Грешка', variant: 'destructive' }) }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Заявки</h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {t.label}
            {t.key === 'my' && myRequests.length > 0 && (
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded-full">{myRequests.length}</span>
            )}
            {t.key === 'low' && lowStockItems.length > 0 && (
              <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">{lowStockItems.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Request — split layout like POS, blue theme */}
      {tab === 'request' && (
        <div className="block">
          {/* Left: product grid */}
          <div className="mr-[382px]">
            {!storeId && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 mb-4">
                Нямате зададен магазин. Свържете се с администратор.
              </div>
            )}

            {/* Category pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
              <Button
                variant={selectedCategory === null ? 'default' : 'outline'}
                size="sm" className="shrink-0 rounded-full"
                onClick={() => setSelectedCategory(null)}
              >
                Всички
              </Button>
              {categories.map(cat => (
                <Button key={cat.id}
                  variant={selectedCategory === cat.id ? 'default' : 'outline'}
                  size="sm" className="shrink-0 rounded-full"
                  onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                >
                  {cat.name}
                </Button>
              ))}
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Търсене на продукт..." value={search}
                onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>

            {/* Product grid */}
            {filteredProducts.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                {search ? `Няма съвпадения за "${search}"` : 'Няма продукти'}
              </p>
            ) : (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredProducts.map(p => {
                  const inBasket = basket.find(i => i.product.id === p.id)
                  return (
                    <button
                      key={p.id}
                      className={`rounded-lg border p-3 text-left transition-all ${
                        inBasket
                          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                          : 'bg-white hover:shadow-md hover:border-slate-300'
                      }`}
                      onClick={() => inBasket ? updateQty(p.id, inBasket.qty + 1) : addToBasket(p)}
                      disabled={!storeId}
                    >
                      <div className="aspect-square bg-slate-100 rounded-md mb-2 flex items-center justify-center overflow-hidden">
                        {imageMap[p.id] ? (
                          <img src={imageMap[p.id]} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="h-8 w-8 text-slate-300" />
                        )}
                      </div>
                      <p className="text-sm font-medium leading-tight line-clamp-2 min-h-[2.5em]">{p.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-sm font-semibold tabular-nums">
                          {p.price != null ? `${p.price.toFixed(2)} €` : '—'}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {p.quantity_on_hand} бр.
                        </span>
                      </div>
                      {inBasket && (
                        <div className="mt-2 text-xs font-medium text-blue-600 bg-blue-100 -mx-3 -mb-3 px-3 py-1.5 rounded-b-lg text-center">
                          В заявката: {inBasket.qty} бр.
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right: Request basket — fixed, same position as POS cart */}
          <div className="hidden lg:block fixed right-8 top-16 w-[350px]" style={{ maxHeight: 'calc(100vh - 5rem)', bottom: '1rem' }}>
            <div className="border-2 border-blue-200 rounded-xl bg-white shadow-sm h-full flex flex-col">
              <div className="p-4 border-b border-blue-100 bg-blue-50/50 rounded-t-xl">
                <h2 className="font-semibold text-blue-800 flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Заявка
                  {basket.length > 0 && (
                    <span className="text-sm font-normal text-blue-600">
                      ({basket.reduce((s, i) => s + i.qty, 0)} бр.)
                    </span>
                  )}
                </h2>
              </div>

              {basket.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <Package className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  <p>Добавете продукти<br />от мрежата в ляво</p>
                </div>
              ) : (
                <>
                  <div className="p-3 space-y-2 max-h-[50vh] overflow-y-auto">
                    {basket.map(item => (
                      <div key={item.product.id} className="flex items-center gap-2 p-2 rounded-md border border-blue-100 bg-blue-50/30">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="h-7 w-7"
                            onClick={() => updateQty(item.product.id, item.qty - 1)}>−</Button>
                          <span className="w-7 text-center text-sm tabular-nums">{item.qty}</span>
                          <Button variant="outline" size="icon" className="h-7 w-7"
                            onClick={() => updateQty(item.product.id, item.qty + 1)}>+</Button>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600"
                          onClick={() => removeFromBasket(item.product.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t border-blue-100 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Общо артикули</span>
                      <span className="font-bold tabular-nums">{basket.reduce((s, i) => s + i.qty, 0)} бр.</span>
                    </div>
                    <Button className="w-full bg-blue-600 hover:bg-blue-700" size="lg"
                      onClick={sendRequest} disabled={sending || !storeId}>
                      {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      {sending ? 'Изпращане...' : 'Изпрати заявка'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: My Requests */}
      {tab === 'my' && (
        <div className="space-y-2">
          {myRequests.length === 0 ? (
            <div className="text-muted-foreground text-center py-12">Нямате заявки</div>
          ) : (
            myRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.quantity} бр. · {sofiaDate(r.created_at)}{' '}
                    {sofiaTime(r.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-[10px] ${STATUS_COLOR[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                  {r.status === 'delivered' && (
                    <Button size="sm" onClick={() => confirmReceipt(r.id, r.quantity)}>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Потвърди
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Low Stock */}
      {tab === 'low' && (
        <div className="space-y-4">
          {lowStockItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="mx-auto h-12 w-12 text-slate-200 mb-3" />
              <p>Всички продукти са с достатъчни наличности</p>
            </div>
          ) : (
            <div className="border rounded-xl divide-y">
              {lowStockItems.map((p: LowStockItem) => (
                <div key={p.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3 min-w-0">
                    {lowStockImageMap[p.id] && (
                      <img src={lowStockImageMap[p.id]} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.category ? `${p.category} · ` : ''}мин. {p.min_quantity} бр.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={p.current_qty === 0 ? 'text-red-600 font-bold text-sm' : 'text-amber-600 font-bold text-sm'}>
                      {p.current_qty} бр.
                    </span>
                    <Button size="sm" variant="outline" onClick={() => {
                      setBasket([{ product: { id: p.id, name: p.name, price: p.price, quantity_on_hand: p.current_qty }, qty: p.min_quantity || 5 }])
                      switchTab('request')
                    }}>
                      Заяви
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
