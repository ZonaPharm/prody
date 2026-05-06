'use client'

import { useReducer, useState } from 'react'
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
}

export function POSClient({ products, categories, frequentlySold, stores, defaultStoreId }: POSClientProps) {
  const { toast } = useToast()
  const [cart, dispatch] = useReducer(cartReducer, initialCartState)
  const [selectedStoreId, setSelectedStoreId] = useState(defaultStoreId)
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

  const handleSubmit = async () => {
    if (cart.items.length === 0) return

    setSubmitting(true)
    try {
      const items = cart.items.map(i => ({
        product_id: i.product.id,
        quantity: i.qty,
        unit_price: i.product.price ?? 0,
      }))

      const res = await fetch('/api/sales/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: selectedStoreId, items }),
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
      <div className="hidden lg:flex gap-6 h-[calc(100vh-8rem)]">
        <div className="flex-1 min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Запиши продажба</h1>
              <p className="text-muted-foreground text-sm mt-1">Кликнете върху продукт за добавяне в количката</p>
            </div>
            {stores.length > 1 && (
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
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
          />
        </div>
        <div className="w-[380px] shrink-0">
          <CartSidebar
            items={cart.items}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onSetQty={handleSetQty}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        </div>
      </div>

      {/* Mobile/Tablet: stacked layout */}
      <div className="lg:hidden flex flex-col h-[calc(100vh-4rem)]">
        <div className="flex-1 overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-lg font-bold">Запиши продажба</h1>
            {stores.length > 1 && (
              <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
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
          />
        </div>
        {cart.items.length > 0 && (
          <CartBottomBar
            items={cart.items}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onSetQty={handleSetQty}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        )}
      </div>
    </>
  )
}
