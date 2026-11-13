'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Plus, X, Send, CheckCircle2, Loader2, Package, Truck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { sofiaTime, sofiaDate } from '@/lib/date-utils'
import { getImageSrc } from '@/lib/images'
import { NOT_REQUESTABLE_TEXT, type NotRequestable } from '@/lib/requests/office-stock'
import { Empty, Hint, Note, PageHeader } from '@/components/ui/text'

interface Product {
  id: string; name: string; price: number | null; category_id?: string | null
  /** Free in Офис: the most this store can ask for now. */
  office_qty: number
}

interface MyRequest {
  id: string; product_name: string; quantity: number
  status: string; notes: string | null; created_at: string
  accepted_at?: string; in_transit_at?: string; delivered_at?: string
}

interface LowStockItem {
  id: string; name: string; price: number | null
  category: string | null; min_quantity: number; current_qty: number
  office_qty: number; office_reason: string | null
}

interface Props {
  /** Only what Офис can send now. */
  products: Product[]
  /** The rest of the active catalog: named with the reason when searched for. */
  unavailable?: { id: string; name: string; why: NotRequestable }[]
  /** Офис stock could not be read: nothing can be asked for right now. */
  officeFailed?: boolean
  categories: { id: string; name: string }[]
  imageMap: Record<string, string>
  myRequests: MyRequest[]
  activeTab: string
  storeId: string | null | undefined
  lowStockItems: LowStockItem[]
  lowStockImageMap: Record<string, string>
  /** Opens the request form with this product already in the basket. */
  initialProductId?: string
  /** Per product: "Вече идва към вас: …" when Офис already sends it to this store. */
  incoming?: Record<string, string>
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

// short: what fits three tabs side by side on a phone.
const TABS = [
  { key: 'request', label: 'Заяви', short: 'Заяви' },
  { key: 'my', label: 'Моите заявки', short: 'Моите' },
  { key: 'low', label: 'Ниски наличности', short: 'Ниски' },
]

export function MyRequestsClient({ products, categories, imageMap, myRequests, activeTab, storeId, lowStockItems, lowStockImageMap, initialProductId, incoming = {}, unavailable = [], officeFailed = false }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [tab, setTab] = useState(activeTab)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  // Arriving from the "Заяви" button on an out-of-stock product: start with it
  // in the basket. An unknown or inactive id is simply ignored.
  const [basket, setBasket] = useState<{ product: Product; qty: number }[]>(() => {
    const preset = initialProductId ? products.find(p => p.id === initialProductId) : undefined
    return preset ? [{ product: preset, qty: 1 }] : []
  })
  const [sending, setSending] = useState(false)
  const [basketOpen, setBasketOpen] = useState(false)
  const [detail, setDetail] = useState<MyRequest | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [noteText, setNoteText] = useState('')
  const [loadingDetail, setLoadingDetail] = useState(false)

  const openDetail = async (req: MyRequest) => {
    setDetail(req)
    setLoadingDetail(true)
    try {
      const [evRes, ntRes] = await Promise.all([
        fetch(`/api/inventory/requests/${req.id}/events`),
        fetch(`/api/inventory/requests/${req.id}/notes`),
      ])
      setEvents((await evRes.json()) || [])
      setNotes((await ntRes.json()) || [])
    } catch { setEvents([]); setNotes([]) }
    setLoadingDetail(false)
  }

  const sendNote = async () => {
    if (!noteText.trim() || !detail) return
    const res = await fetch(`/api/inventory/requests/${detail.id}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: noteText }),
    })
    if (res.ok) {
      const n = await res.json()
      setNotes(prev => [...prev, n])
      setNoteText('')
    }
  }

  const switchTab = (t: string) => {
    setTab(t)
    router.push(`/my-requests?tab=${t}`)
  }

  const filteredProducts = products.filter(p => {
    if (selectedCategory && p.category_id !== selectedCategory) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).slice(0, 100)

  // Searched for something Офис cannot send: say so and why, instead of nothing.
  const q = search.trim().toLowerCase()
  const blocked = q.length >= 2 ? unavailable.filter(p => p.name.toLowerCase().includes(q)).slice(0, 6) : []
  const presetBlocked = initialProductId && !products.some(p => p.id === initialProductId)
    ? unavailable.find(p => p.id === initialProductId)
    : undefined

  const tooMany = (p: Product) =>
    toast({ title: `В Офис има ${p.office_qty} бр. от „${p.name}“`, description: 'Толкова е най-много, което може да се заяви сега.' })

  const addToBasket = (product: Product) => {
    const existing = basket.find(i => i.product.id === product.id)
    if (existing && existing.qty >= product.office_qty) { tooMany(product); return }
    setBasket(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: Math.min(i.qty + 1, product.office_qty) } : i)
      return [...prev, { product, qty: 1 }]
    })
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) { setBasket(prev => prev.filter(i => i.product.id !== productId)); return }
    const item = basket.find(i => i.product.id === productId)
    if (item && qty > item.product.office_qty) { tooMany(item.product); return }
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
        return
      }
      // A rejected confirmation used to do nothing at all on screen.
      const body = await res.json().catch(() => ({}))
      toast({ title: body.error || 'Потвърждаването не мина', variant: 'destructive' })
    } catch { toast({ title: 'Грешка при потвърждаване', variant: 'destructive' }) }
  }

  const basketQty = basket.reduce((s, i) => s + i.qty, 0)
  const basketRows = basket.map(item => (
                      <div key={item.product.id} className="flex items-center gap-2 p-2 rounded-md border border-blue-100 bg-blue-50/30">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'} · в Офис {item.product.office_qty} бр.
                          </p>
                          {incoming[item.product.id] && (
                            <p className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-800">
                              <Truck className="mt-px h-3.5 w-3.5 shrink-0" />{incoming[item.product.id]}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="h-9 w-9 lg:h-7 lg:w-7"
                            onClick={() => updateQty(item.product.id, item.qty - 1)}>−</Button>
                          <span className="w-7 text-center text-sm tabular-nums">{item.qty}</span>
                          <Button variant="outline" size="icon" className="h-9 w-9 lg:h-7 lg:w-7"
                            disabled={item.qty >= item.product.office_qty}
                            onClick={() => updateQty(item.product.id, item.qty + 1)}>+</Button>
                        </div>
                        <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7 text-red-400 hover:text-red-600"
                          onClick={() => removeFromBasket(item.product.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))

  return (
    <div className="space-y-6">
      <PageHeader title="Заявки" intro="Поискайте от Офис стока за вашия магазин и следете заявките си." />

      {/* Tabs — button style */}
      <div className="no-scrollbar flex gap-1 bg-slate-100 rounded-lg p-1 w-full sm:w-fit overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`flex-1 sm:flex-none justify-center whitespace-nowrap px-2 sm:px-4 py-2.5 sm:py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              tab === t.key ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}>
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
            {t.key === 'my' && myRequests.length > 0 && (
              <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full">{myRequests.length}</span>
            )}
            {t.key === 'low' && lowStockItems.length > 0 && (
              <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full">{lowStockItems.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Request — same layout as POS: products left, basket fixed right */}
      {tab === 'request' && (
        <div className="block">
          {/* Left: product grid with right margin for basket */}
          <div className="pb-16 lg:pb-0 lg:mr-[382px]">
            {!storeId && (
              <Note tone="warn" className="mb-4">Нямате зададен магазин. Свържете се с администратор.</Note>
            )}

            <Hint className="mb-3">
              Изберете продукти и натиснете „Изпрати“. Тук са само продуктите, които Офис може да изпрати сега; „в Офис N“ е колко има свободни.
            </Hint>

            {officeFailed && (
              <Note tone="danger" className="mb-4">Не успяхме да прочетем наличността в Офис. Опитайте пак след малко.</Note>
            )}

            {presetBlocked && (
              <Note tone="warn" className="mb-4">
                <b>{presetBlocked.name}</b> не може да се заяви: {NOT_REQUESTABLE_TEXT[presetBlocked.why].toLowerCase()}.
                {incoming[presetBlocked.id] ? ` ${incoming[presetBlocked.id]}` : ''}
              </Note>
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

            {/* Not requestable: named with the reason, so nobody hunts for it. */}
            {blocked.length > 0 && (
              <Note tone="info" className="mb-4">
                <p className="mb-1 font-semibold text-slate-900">Не може да се заяви сега</p>
                <ul className="space-y-1">
                  {blocked.map(p => (
                    <li key={p.id} className="text-sm">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground"> · {NOT_REQUESTABLE_TEXT[p.why]}</span>
                      {incoming[p.id] && (
                        <span className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-800">
                          <Truck className="mt-px h-3.5 w-3.5 shrink-0" />{incoming[p.id]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Note>
            )}

            {/* Product grid */}
            {filteredProducts.length === 0 ? (
              <Empty className="py-12">
                {search
                  ? (blocked.length > 0 ? 'Няма други съвпадения, които Офис може да изпрати.' : `Няма съвпадения за "${search}"`)
                  : products.length === 0 ? 'В момента Офис няма стока, която може да се заяви.' : 'Няма продукти в тази категория'}
              </Empty>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
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
                          <img src={getImageSrc(imageMap[p.id])} alt="" className="w-full h-full object-cover" />
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
                          в Офис {p.office_qty}
                        </span>
                      </div>
                      {incoming[p.id] && (
                        <p className="mt-1.5 flex items-start gap-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] font-medium leading-tight text-amber-800">
                          <Truck className="h-3.5 w-3.5 shrink-0" />{incoming[p.id]}
                        </p>
                      )}
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

          {/* Right: Request basket — same positioning as POS cart */}
          <div className="hidden lg:block fixed right-6 top-6 bottom-6 w-[350px]">
            <div className="border-2 border-blue-200 rounded-xl bg-white shadow-sm flex flex-col h-full">
              <div className="p-4 border-b border-blue-100 bg-blue-50/50 rounded-t-xl shrink-0">
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
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                  <div className="text-center">
                    <Package className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p>Добавете продукти<br />от мрежата в ляво</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {basketRows}
                  </div>
                  <div className="p-4 border-t border-blue-100 shrink-0 space-y-3">
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

          {/* Phone: the basket is a bar above the tab bar; tap it to see and change the list. */}
          <div className="lg:hidden fixed inset-x-0 bottom-[var(--bottom-nav-h)] z-30 border-t bg-white/95 backdrop-blur shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
            {basketOpen && basket.length > 0 && (
              <div className="max-h-[50vh] overflow-y-auto p-3 space-y-2 border-b">{basketRows}</div>
            )}
            <div className="flex items-center gap-3 px-4 py-2.5">
              <button type="button" onClick={() => setBasketOpen(o => !o)} className="flex flex-1 items-center gap-2 min-w-0 text-left" disabled={basket.length === 0}>
                <Send className="h-5 w-5 text-blue-700 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Заявка</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {basket.length === 0 ? 'празна' : `${basket.length} продукта · ${basketQty} бр. · ${basketOpen ? 'скрий' : 'виж'}`}
                  </span>
                </span>
              </button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={sendRequest} disabled={sending || !storeId || basket.length === 0}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Изпрати
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: My Requests */}
      {tab === 'my' && (
        <div className="space-y-2">
          {myRequests.length === 0 ? (
            <Empty className="py-12">Нямате заявки</Empty>
          ) : (
            myRequests.map(r => (
              <div key={r.id}
                className="flex items-center justify-between p-3 border rounded-lg bg-white cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
                onClick={() => openDetail(r)}
              >
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
                <div key={p.id} className="p-3 flex items-center gap-3 hover:bg-slate-50">
                  {lowStockImageMap[p.id] ? (
                    <img src={getImageSrc(lowStockImageMap[p.id])} alt="" className="h-11 w-11 rounded object-cover shrink-0" />
                  ) : (
                    <div className="h-11 w-11 rounded bg-slate-100 shrink-0 flex items-center justify-center"><Package className="h-5 w-5 text-slate-300" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug line-clamp-2">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.category ? `${p.category} · ` : ''}мин. {p.min_quantity} бр.
                    </p>
                    {incoming[p.id] && (
                      <p className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-800">
                        <Truck className="mt-px h-3.5 w-3.5 shrink-0" />{incoming[p.id]}
                      </p>
                    )}
                  </div>
                  {/* Right: what is left here, and under it either "Заяви" or why it can't be asked for */}
                  <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                    <span className={p.current_qty === 0 ? 'text-red-600 font-bold text-sm tabular-nums' : 'text-amber-600 font-bold text-sm tabular-nums'}>
                      {p.current_qty} бр.
                    </span>
                    {p.office_qty > 0 ? (
                      <Button size="sm" variant="outline" className="h-9" onClick={() => {
                        const product = products.find(x => x.id === p.id)
                          ?? { id: p.id, name: p.name, price: p.price, office_qty: p.office_qty }
                        setBasket(prev => [
                          ...prev.filter(i => i.product.id !== p.id),
                          { product, qty: Math.max(1, Math.min(p.min_quantity || 5, product.office_qty)) },
                        ])
                        switchTab('request')
                      }}>
                        Заяви
                      </Button>
                    ) : (
                      <span className="max-w-[7.5rem] rounded bg-slate-100 px-1.5 py-0.5 text-[11px] leading-tight text-slate-500">
                        {p.office_reason ?? 'Няма го в Офис'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Detail Dialog */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setDetail(null); setEvents([]); setNotes([]) }} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4">
            <div className="p-4 border-b flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-bold text-lg">{detail.product_name}</h3>
                <p className="text-sm text-muted-foreground">
                  {detail.quantity} бр. · {sofiaDate(detail.created_at)} {sofiaTime(detail.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
                {detail.status === 'delivered' && (
                  <Button size="sm" onClick={() => { confirmReceipt(detail.id, detail.quantity); setDetail(null) }}>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Потвърди
                  </Button>
                )}
              </div>
            </div>

            {loadingDetail ? (
              <div className="p-6 text-center"><Loader2 className="animate-spin mx-auto h-6 w-6 text-muted-foreground" /></div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Events timeline */}
                {events.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">История на статусите</p>
                    <div className="space-y-0 pl-4 border-l-2 border-slate-200">
                      {events.map((evt: any, i: number) => {
                        const dotColor =
                          evt.status === 'pending' ? 'bg-amber-400' :
                          evt.status === 'accepted' ? 'bg-sky-400' :
                          evt.status === 'in_transit' ? 'bg-indigo-400' :
                          evt.status === 'delivered' ? 'bg-teal-400' :
                          evt.status === 'rejected' ? 'bg-red-400' :
                          evt.status === 'confirmed' ? 'bg-green-400' :
                          evt.status === 'partial' ? 'bg-orange-400' : 'bg-slate-400'
                        return (
                          <div key={i} className="relative pb-2">
                            <div className={`absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white ${dotColor}`} />
                            <p className="text-xs text-muted-foreground">
                              {new Date(evt.created_at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}
                            </p>
                            <p className="text-xs">{evt.notes}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Comments */}
                <div>
                  <p className="text-sm font-medium mb-2">Коментари</p>
                  {notes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Няма коментари</p>
                  ) : (
                    <div className="space-y-2">
                      {notes.map((n: any) => (
                        <div key={n.id} className="bg-slate-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium">{n.user_name || '—'}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(n.created_at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}
                            </span>
                          </div>
                          <p className="text-sm">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Input value={noteText} onChange={e => setNoteText(e.target.value)}
                      placeholder="Напишете коментар..." className="h-8 text-sm"
                      onKeyDown={e => { if (e.key === 'Enter') sendNote() }} />
                    <Button size="sm" onClick={sendNote} disabled={!noteText.trim()}>Изпрати</Button>
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 border-t shrink-0">
              <Button variant="ghost" className="w-full"
                onClick={() => { setDetail(null); setEvents([]); setNotes([]) }}>
                Затвори
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
