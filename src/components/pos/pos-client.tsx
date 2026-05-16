'use client'

import { useReducer, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { Product } from './cart-types'
import { cartReducer, initialCartState } from './cart-reducer'
import { ProductGrid } from './product-grid'
import { CartSidebar, CartBottomBar } from './cart-sidebar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface POSClientProps {
  products: Product[]
  categories: { id: string; name: string }[]
  frequentlySold: Product[]
  stores: { id: string; name: string }[]
  defaultStoreId: string
  outOfStock?: Product[]
}

export function POSClient({ products, categories, frequentlySold, stores, defaultStoreId, outOfStock }: POSClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [cart, dispatch] = useReducer(cartReducer, initialCartState)
  const [selectedStoreId, setSelectedStoreId] = useState(defaultStoreId)

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId)
    const params = new URLSearchParams(window.location.search)
    params.set('store', storeId)
    router.push(`/record-sale?${params.toString()}`)
  }
  const [paymentMethod, setPaymentMethod] = useState('')
  const [showPaymentPopup, setShowPaymentPopup] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleAddToCart = (product: Product) => {
    dispatch({ type: 'ADD', product })
  }

  const handleAdd = (productId: string) => {
    const item = cart.items.find(i => i.product.id === productId)
    if (item) {
      dispatch({ type: 'ADD', product: item.product })
    }
  }

  const handleRemove = (productId: string) => {
    dispatch({ type: 'REMOVE', productId })
  }

  const handleSetQty = (productId: string, qty: number) => {
    dispatch({ type: 'SET_QTY', productId, qty })
  }

  const handleSubmit = async (forcedMethod?: string) => {
    if (cart.items.length === 0) return

    const method = forcedMethod || paymentMethod
    if (!method || !['cash', 'card'].includes(method)) {
      setShowPaymentPopup(true)
      return
    }

    setSubmitting(true)
    setShowPaymentPopup(false)
    try {
      const items = cart.items.map(i => ({
        product_id: i.product.id,
        quantity: i.qty,
        unit_price: i.product.price ?? 0,
      }))

      const res = await fetch('/api/sales/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: selectedStoreId, items, payment_method: method }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Грешка при записване')
      }

      toast({ title: 'Продажбата е записана' })
      dispatch({ type: 'CLEAR' })
    } catch (err: any) {
      toast({ title: err.message || 'Грешка при записване', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Desktop layout: 60/40 split */}
      <div className="hidden lg:flex gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Запиши продажба</h1>
              <p className="text-muted-foreground text-sm mt-1">Кликнете върху продукт за добавяне в количката</p>
            </div>
            {stores.length > 1 && (
              <Select value={selectedStoreId} onValueChange={handleStoreChange}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stores.map(store => (
                    <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <ProductGrid
            products={products}
            categories={categories}
            frequentlySold={frequentlySold}
            onAddToCart={handleAddToCart}
            outOfStock={outOfStock}
          />
        </div>
        <div className="w-[380px] shrink-0 self-start sticky top-4" style={{maxHeight: 'calc(100vh - 6rem)'}}>
          <CartSidebar
            items={cart.items}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onSetQty={handleSetQty}
            onSubmit={handleSubmit}
            submitting={submitting}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
          />
        </div>
      </div>

      {/* Mobile/Tablet: stacked layout */}
      <div
        className="lg:hidden pb-16"
        style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-bold">Запиши продажба</h1>
          {stores.length > 1 && (
            <Select value={selectedStoreId} onValueChange={handleStoreChange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <ProductGrid
          products={products}
          categories={categories}
          frequentlySold={frequentlySold}
          onAddToCart={handleAddToCart}
          outOfStock={outOfStock}
        />
        <div
          className="fixed bottom-0 left-0 right-0 z-30"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <CartBottomBar
            items={cart.items}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onSetQty={handleSetQty}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        </div>
      </div>

      {/* Payment method popup */}
      {showPaymentPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPaymentPopup(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-[300px] space-y-4">
            <h3 className="text-lg font-bold text-center">Избери начин на плащане</h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleSubmit('cash')}
                className="p-4 rounded-lg border-2 border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-colors text-center"
              >
                <div className="text-2xl mb-1">💵</div>
                <div className="font-semibold">Кеш</div>
              </button>
              <button
                onClick={() => handleSubmit('card')}
                className="p-4 rounded-lg border-2 border-slate-200 hover:border-green-500 hover:bg-green-50 transition-colors text-center"
              >
                <div className="text-2xl mb-1">💳</div>
                <div className="font-semibold">Карта</div>
              </button>
            </div>
            <button
              onClick={() => setShowPaymentPopup(false)}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Отказ
            </button>
          </div>
        </div>
      )}
    </>
  )
}
