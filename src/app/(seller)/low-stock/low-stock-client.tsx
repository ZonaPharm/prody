'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Send, Check } from 'lucide-react'

interface LowStockItem {
  id: string
  name: string
  price: number | null
  category: string | null
  min_quantity: number
  current_qty: number
}

export function LowStockClient({ items, storeId }: { items: LowStockItem[]; storeId: string }) {
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<string | null>(null)

  const requestStock = async (productId: string) => {
    setLoading(productId)
    try {
      await fetch('/api/inventory/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          store_id: storeId,
          quantity: 20,
          notes: 'Заявка от продавач',
        }),
      })
      setRequestedIds(prev => new Set(prev).add(productId))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ниски наличности</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Продукти под минималното количество във вашия магазин
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">
          <AlertTriangle className="mx-auto h-10 w-10 mb-3 text-green-500" />
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
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {item.category || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold tabular-nums ${
                      item.current_qty === 0 ? 'text-red-600' : 'text-amber-600'
                    }`}>
                      {item.current_qty}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground hidden sm:table-cell tabular-nums">
                    {item.min_quantity}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {requestedIds.has(item.id) ? (
                      <span className="text-xs text-green-600 flex items-center justify-end gap-1">
                        <Check className="h-3 w-3" /> Заявено
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => requestStock(item.id)}
                        disabled={loading === item.id}
                      >
                        <Send className="mr-1 h-3 w-3" />
                        Заяви
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
  )
}
