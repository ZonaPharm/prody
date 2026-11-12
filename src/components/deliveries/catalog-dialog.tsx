'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { BookOpen, Loader2 } from 'lucide-react'
import type { DeliveryProduct } from '@/lib/deliveries/products'
import { ProductThumb } from './product-picker'

type Option = { id: string; name: string }

/**
 * "Каталог": the catalogue's filters with a tick per product, to add many lines at once.
 */
export function CatalogDialog({
  categories,
  stores,
  inDelivery,
  onAdd,
  disabled,
}: {
  categories: Option[]
  stores: Option[]
  inDelivery: Set<string>
  onAdd: (products: DeliveryProduct[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [store, setStore] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [items, setItems] = useState<DeliveryProduct[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Map<string, DeliveryProduct>>(new Map())

  const load = useCallback(async (offset: number) => {
    setLoading(true)
    setError('')
    try {
      const sp = new URLSearchParams({ offset: String(offset), status })
      if (search.trim()) sp.set('search', search.trim())
      if (category) sp.set('category', category)
      if (store) sp.set('store', store)
      const res = await fetch(`/api/deliveries/products/catalog?${sp}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Каталогът не се зареди')
      setItems(prev => (offset === 0 ? data.products : [...prev, ...data.products]))
      setHasMore(data.hasMore)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, category, store, status])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => load(0), 250)
    return () => clearTimeout(t)
  }, [open, load])

  function toggle(p: DeliveryProduct) {
    setPicked(prev => {
      const next = new Map(prev)
      if (next.has(p.id)) next.delete(p.id)
      else next.set(p.id, p)
      return next
    })
  }

  function add() {
    onAdd([...picked.values()])
    setPicked(new Map())
    setOpen(false)
  }

  const selectClass = 'h-9 rounded-md border border-input bg-white px-2 text-sm'

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <BookOpen className="mr-2 h-4 w-4" />Каталог
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Добавяне от каталога</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Търсене по име" className="flex-1 min-w-[160px]" />
            <select className={selectClass} value={category} onChange={e => setCategory(e.target.value)} aria-label="Категория">
              <option value="">Всички категории</option>
              <option value="__none__">Без категория</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={selectClass} value={store} onChange={e => setStore(e.target.value)} aria-label="Обект">
              <option value="">Всички обекти</option>
              {stores.map(s => <option key={s.id} value={s.id}>С наличност в {s.name}</option>)}
            </select>
            <select className={selectClass} value={status} onChange={e => setStatus(e.target.value as 'active' | 'inactive')} aria-label="Статус">
              <option value="active">Активни</option>
              <option value="inactive">Неактивни</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex-1 overflow-auto rounded border min-h-[240px]">
            {items.map(p => {
              const already = inDelivery.has(p.id)
              return (
                <label key={p.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4" checked={picked.has(p.id)} onChange={() => toggle(p)} />
                  <ProductThumb src={p.image} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.sku ? `${p.sku} · ` : ''}наличност {p.quantity_on_hand} бр.
                      {already && <span className="ml-1 text-amber-700">· вече е в доставката</span>}
                    </span>
                  </span>
                </label>
              )
            })}
            {!loading && items.length === 0 && <p className="p-4 text-sm text-muted-foreground">Няма продукти с тези филтри.</p>}
            {loading && <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {hasMore && !loading && (
              <div className="p-2 text-center">
                <Button type="button" variant="ghost" size="sm" onClick={() => load(items.length)}>Още</Button>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-sm text-muted-foreground">Избрани: {picked.size}</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Затвори</Button>
              <Button type="button" onClick={add} disabled={picked.size === 0}>Добави избраните</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
