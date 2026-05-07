'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CartItem } from './cart-types'
import { Minus, Plus, X, ShoppingCart } from 'lucide-react'

interface CartSidebarProps {
  items: CartItem[]
  onAdd: (productId: string) => void
  onRemove: (productId: string) => void
  onSetQty: (productId: string, qty: number) => void
  onSubmit: () => void
  submitting: boolean
  paymentMethod: string
  onPaymentMethodChange: (method: string) => void
}

export function CartSidebar({ items, onAdd, onRemove, onSetQty, onSubmit, submitting }: CartSidebarProps) {
  const total = items.reduce((sum, i) => sum + i.qty * (i.product.price ?? 0), 0)

  return (
    <div className="flex flex-col h-full rounded-lg border bg-white">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Количка
          {items.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({items.length})
            </span>
          )}
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground text-sm">
          <p>Добавете продукти от мрежата</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="p-3 space-y-2">
            {items.map(item => (
              <div
                key={item.product.id}
                className="flex items-center gap-3 p-3 rounded-md border bg-slate-50/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => item.qty <= 1 ? onRemove(item.product.id) : onSetQty(item.product.id, item.qty - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-8 text-center text-sm font-medium tabular-nums">
                    {item.qty}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onAdd(item.product.id)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                <div className="text-right min-w-[60px]">
                  <p className="text-sm font-semibold tabular-nums">
                    {((item.product.price ?? 0) * item.qty).toFixed(2)} €
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-500 shrink-0"
                  onClick={() => onRemove(item.product.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-t space-y-3">
        {/* Payment method */}
        <div className="flex gap-2">
          {[
            { value: 'cash', label: 'Кеш' },
            { value: 'card', label: 'Карта' },
            { value: 'transfer', label: 'Превод' },
          ].map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => onPaymentMethodChange(m.value)}
              className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                paymentMethod === m.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-lg font-bold">
          <span>Общо</span>
          <span className="tabular-nums">{total.toFixed(2)} €</span>
        </div>
        <Button
          className="w-full"
          size="lg"
          disabled={items.length === 0 || submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Записване...' : 'Завърши продажба'}
        </Button>
      </div>
    </div>
  )
}

// CartBottomBar — mobile sticky bar + expandable drawer
export function CartBottomBar({ items, onAdd, onRemove, onSetQty, onSubmit, submitting, paymentMethod, onPaymentMethodChange }: CartSidebarProps) {
  const total = items.reduce((sum, i) => sum + i.qty * (i.product.price ?? 0), 0)
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      {/* Collapsed bar */}
      <div className="sticky bottom-0 border-t bg-white p-3 flex items-center gap-3 shadow-lg z-30">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={() => setExpanded(!expanded)}
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-medium text-sm">Количка ({items.length})</span>
          <span className="text-sm font-bold ml-auto tabular-nums">{total.toFixed(2)} €</span>
        </button>
        <Button size="sm" onClick={onSubmit} disabled={submitting}>
          {submitting ? '...' : 'Завърши'}
        </Button>
      </div>

      {/* Expanded drawer */}
      {expanded && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setExpanded(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white border-t rounded-t-xl shadow-2xl max-h-[70vh] flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="font-semibold">Количка</h3>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>Готово</Button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {items.map(item => (
                <div key={item.product.id} className="flex items-center gap-2 p-2 rounded-md border bg-slate-50/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => item.qty <= 1 ? onRemove(item.product.id) : onSetQty(item.product.id, item.qty - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-7 text-center text-sm tabular-nums">{item.qty}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => onAdd(item.product.id)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                    onClick={() => onRemove(item.product.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="px-3 pb-1">
              <div className="flex gap-2">
                {[
                  { value: 'cash', label: 'Кеш' },
                  { value: 'card', label: 'Карта' },
                  { value: 'transfer', label: 'Превод' },
                ].map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => onPaymentMethodChange(m.value)}
                    className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${
                      paymentMethod === m.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 border-t">
              <Button className="w-full" size="lg" onClick={onSubmit} disabled={submitting}>
                Завърши продажба · {total.toFixed(2)} €
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
