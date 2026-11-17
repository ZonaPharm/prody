'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
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
  paymentMethod?: string
  onPaymentMethodChange?: (method: string) => void
}

export function CartSidebar({ items, onAdd, onRemove, onSetQty, onSubmit, submitting, paymentMethod, onPaymentMethodChange }: CartSidebarProps) {
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
                className="flex items-center gap-2 p-3 rounded-md border bg-slate-50/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2" title={item.product.name}>{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                  </p>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => item.qty <= 1 ? onRemove(item.product.id) : onSetQty(item.product.id, item.qty - 1)}
                  >
                    <Minus className="h-2.5 w-2.5" />
                  </Button>
                  <span className="w-6 text-center text-sm font-medium tabular-nums">
                    {item.qty}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onAdd(item.product.id)}
                  >
                    <Plus className="h-2.5 w-2.5" />
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
        <div className="flex items-center justify-between text-lg font-bold">
          <span>Общо</span>
          <span className="tabular-nums">{total.toFixed(2)} €</span>
        </div>
        <Button
          className="w-full"
          size="lg"
          disabled={items.length === 0 || submitting}
          onClick={() => onSubmit()}
        >
          {submitting ? 'Записване...' : 'Завърши продажба'}
        </Button>
      </div>
    </div>
  )
}

// CartBottomBar — mobile sticky bar + expandable drawer
export function CartBottomBar({ items, onAdd, onRemove, onSetQty, onSubmit, submitting }: CartBottomBarProps) {
  const total = items.reduce((sum, i) => sum + i.qty * (i.product.price ?? 0), 0)
  const pieces = items.reduce((sum, i) => sum + i.qty, 0)
  const [expanded, setExpanded] = useState(false)
  const pay = (method: 'cash' | 'card') => {
    setExpanded(false)
    onSubmit(method)
  }

  return (
    <>
      {/* Collapsed bar: what is in the cart, and the one next step */}
      <div className="border-t bg-white px-3 py-2 flex items-center gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <button
          type="button"
          data-testid="cart-open"
          className="flex items-center gap-2 flex-1 min-w-0 h-11 text-left disabled:opacity-60"
          disabled={items.length === 0}
          onClick={() => setExpanded(true)}
        >
          <span className="relative">
            <ShoppingCart className="h-6 w-6" />
            {pieces > 0 && (
              <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-emerald-600 px-1 text-center text-[11px] font-semibold leading-5 text-white">{pieces}</span>
            )}
          </span>
          {items.length > 0 ? (
            <span className="ml-1 min-w-0">
              <span className="block text-base font-bold tabular-nums leading-tight">{total.toFixed(2)} €</span>
              <span className="block text-xs text-primary leading-tight">Виж количката</span>
            </span>
          ) : (
            <span className="ml-1 text-sm text-muted-foreground">Докоснете продукт, за да го добавите</span>
          )}
        </button>
        {items.length > 0 && (
          <Button
            className="h-11 px-5 text-base"
            onClick={() => setExpanded(true)}
            disabled={submitting}
          >
            {submitting ? 'Записване…' : 'Плащане'}
          </Button>
        )}
      </div>

      {/* Expanded drawer: change pieces, then pay in cash or by card in one tap.
          In a portal: the bar sits in a fixed layer under the tab bar, and the
          drawer has to cover the tab bar, or it hides the payment buttons. */}
      {expanded && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setExpanded(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col pb-[env(safe-area-inset-bottom)]" role="dialog" aria-label="Количка">
            <div className="px-4 pt-3 pb-2 border-b flex items-center justify-between">
              <h3 className="font-semibold text-lg">Количка <span className="text-sm font-normal text-muted-foreground">({pieces} бр.)</span></h3>
              <Button variant="ghost" className="h-10" onClick={() => setExpanded(false)}>Добави още</Button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {items.map(item => (
                <div key={item.product.id} className="flex items-center gap-2 p-2 rounded-lg border bg-slate-50/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2" title={item.product.name}>{item.product.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                      {item.qty > 1 && item.product.price != null && <> · общо <b className="text-slate-700">{(item.product.price * item.qty).toFixed(2)} €</b></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Едно по-малко"
                      onClick={() => item.qty <= 1 ? onRemove(item.product.id) : onSetQty(item.product.id, item.qty - 1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-7 text-center text-base font-semibold tabular-nums">{item.qty}</span>
                    <Button variant="outline" size="icon" className="h-10 w-10" aria-label="Едно повече"
                      onClick={() => onAdd(item.product.id)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" className="h-10 w-10 text-red-500" aria-label="Махни от количката"
                    onClick={() => onRemove(item.product.id)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="p-3 border-t space-y-3">
              <div className="flex items-center justify-between text-xl font-bold">
                <span>Общо</span>
                <span className="tabular-nums">{total.toFixed(2)} €</span>
              </div>
              <p className="text-sm text-muted-foreground">Как плаща клиентът? Натискането записва продажбата.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-14 text-base bg-blue-600 hover:bg-blue-700" data-testid="pay-cash" disabled={submitting || items.length === 0} onClick={() => pay('cash')}>
                  💵 В брой
                </Button>
                <Button className="h-14 text-base bg-emerald-600 hover:bg-emerald-700" data-testid="pay-card" disabled={submitting || items.length === 0} onClick={() => pay('card')}>
                  💳 С карта
                </Button>
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

interface CartBottomBarProps {
  items: CartItem[]
  onAdd: (productId: string) => void
  onRemove: (productId: string) => void
  onSetQty: (productId: string, qty: number) => void
  /** Records the sale paid this way. */
  onSubmit: (method: 'cash' | 'card') => void
  submitting: boolean
}
