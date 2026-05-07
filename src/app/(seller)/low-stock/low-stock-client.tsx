'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle, Send, Check, Search } from 'lucide-react'

interface ProductItem {
  id: string
  name: string
  price: number | null
  category: string | null
  min_quantity: number
  current_qty: number
}

export function LowStockClient({
  items,
  storeId,
  allProducts,
}: {
  items: ProductItem[]
  storeId: string
  allProducts: { id: string; name: string; price: number | null; category: { name: string } | null }[]
}) {
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')

  const requestStock = async (productId: string) => {
    setLoading(productId)
    const qty = quantities[productId] || 10
    try {
      await fetch('/api/inventory/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, store_id: storeId, quantity: qty, notes: 'Заявка от продавач' }),
      })
      setRequestedIds(prev => new Set(prev).add(productId))
    } finally {
      setLoading(null)
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
        else cat = String(c).toLowerCase()
      }
      return name.includes(q) || cat.includes(q)
    }).slice(0, 20)
  }, [search, allProducts])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Заявки</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Заявете необходимите ви количества от администратора
        </p>
      </div>

      {/* Search any product */}
      <div className="rounded-lg border bg-white p-4">
        <p className="text-sm font-medium mb-3">Заяви продукт</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Търсене на продукт..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {filteredProducts.length > 0 && (
          <div className="mt-3 border rounded-md divide-y max-h-[300px] overflow-auto">
            {filteredProducts.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-2 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  {p.category && (
                    <p className="text-xs text-muted-foreground">
                      {Array.isArray(p.category) ? p.category[0]?.name : p.category?.name || p.category}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  {requestedIds.has(p.id) ? (
                    <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Заявено</span>
                  ) : (
                    <>
                      <input type="number" min="1" className="w-16 h-8 border rounded px-2 text-sm text-center"
                        placeholder="10"
                        value={quantities[p.id] || ''}
                        onChange={e => setQuantities(prev => ({ ...prev, [p.id]: parseInt(e.target.value) || 0 }))}
                      />
                      <Button size="sm" variant="outline"
                        onClick={() => requestStock(p.id)}
                        disabled={loading === p.id}>
                        <Send className="mr-1 h-3 w-3" /> Заяви
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {search.length >= 2 && filteredProducts.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Няма намерени продукти</p>
        )}
      </div>

      {/* Low stock warning */}
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Ниски наличности
          {items.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({items.length} продукта)</span>
          )}
        </h2>

        {items.length === 0 ? (
          <div className="rounded-md border bg-white p-8 text-center text-muted-foreground">
            <p>Всички продукти са с достатъчни наличности</p>
          </div>
        ) : (
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Продукт</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Категория</th>
                  <th className="text-center px-4 py-3 font-medium">Налични</th>
                  <th className="text-center px-4 py-3 font-medium hidden sm:table-cell">Мин.</th>
                  <th className="text-right px-4 py-3 font-medium">Действие</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <span className="font-medium">{item.name}</span>
                      {item.price != null && (
                        <span className="text-muted-foreground ml-2">{item.price.toFixed(2)} €</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{item.category || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold tabular-nums ${item.current_qty === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                        {item.current_qty}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground hidden sm:table-cell tabular-nums">{item.min_quantity}</td>
                    <td className="px-4 py-3 text-right">
                      {requestedIds.has(item.id) ? (
                        <span className="text-xs text-green-600 flex items-center justify-end gap-1">
                          <Check className="h-3 w-3" /> Заявено
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <input type="number" min="1" max="999" className="w-16 h-8 border rounded px-2 text-sm text-center"
                            placeholder="10"
                            value={quantities[item.id] || ''}
                            onChange={e => setQuantities(prev => ({ ...prev, [item.id]: parseInt(e.target.value) || 0 }))}
                          />
                          <Button size="sm" variant="outline"
                            onClick={() => requestStock(item.id)}
                            disabled={loading === item.id}>
                            <Send className="mr-1 h-3 w-3" /> Заяви
                          </Button>
                        </div>
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
