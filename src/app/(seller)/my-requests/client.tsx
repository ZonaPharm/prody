'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Plus, X, Send, CheckCircle2, Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Product {
  id: string; name: string; price: number | null; quantity_on_hand: number
}

interface MyRequest {
  id: string; product_name: string; quantity: number
  status: string; notes: string | null; created_at: string
  accepted_at?: string; in_transit_at?: string; delivered_at?: string
}

interface Props {
  products: Product[]
  myRequests: MyRequest[]
  activeTab: string
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

export function SellerRequestsClient({ products, myRequests, activeTab }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [tab, setTab] = useState(activeTab)
  const [search, setSearch] = useState('')
  const [basket, setBasket] = useState<{ product: Product; qty: number }[]>([])
  const [sending, setSending] = useState(false)

  const switchTab = (t: string) => {
    setTab(t)
    router.push(`/my-requests?tab=${t}`)
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 50)

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
    setSending(true)
    try {
      const res = await fetch('/api/inventory/request-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => switchTab('request')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'request' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}>
          Заяви
        </button>
        <button onClick={() => switchTab('my')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            tab === 'my' ? 'border-blue-600 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}>
          Моите заявки
          {myRequests.length > 0 && (
            <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded-full">{myRequests.length}</span>
          )}
        </button>
      </div>

      {tab === 'request' ? (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Търсене на продукт..." value={search}
              onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          {search && (
            <div className="border rounded-xl divide-y max-h-64 overflow-y-auto">
              {filtered.map(p => (
                <div key={p.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.quantity_on_hand} бр. · {p.price != null ? `${p.price.toFixed(2)} €` : '—'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => addToBasket(p)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground text-center">Няма съвпадения</p>
              )}
            </div>
          )}

          {basket.length > 0 && (
            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-medium">Заявка ({basket.length})</h3>
              {basket.map(item => {
                const lineTotal = item.qty * (item.product.price ?? 0)
                return (
                  <div key={item.product.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {lineTotal > 0 ? `${lineTotal.toFixed(2)} €` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => updateQty(item.product.id, item.qty - 1)}>−</Button>
                      <span className="w-8 text-center text-sm tabular-nums">{item.qty}</span>
                      <Button variant="outline" size="icon" className="h-7 w-7"
                        onClick={() => updateQty(item.product.id, item.qty + 1)}>+</Button>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                      onClick={() => removeFromBasket(item.product.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )
              })}
              <Button className="w-full" onClick={sendRequest} disabled={sending}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {sending ? 'Изпращане...' : 'Изпрати заявка'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {myRequests.length === 0 ? (
            <div className="text-muted-foreground text-center py-12">Нямате заявки</div>
          ) : (
            myRequests.map(r => (
              <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{r.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.quantity} бр. · {new Date(r.created_at).toLocaleDateString('bg-BG')}{' '}
                    {new Date(r.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}
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
    </div>
  )
}
