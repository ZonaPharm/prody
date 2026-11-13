'use client'

import { useEffect, useReducer, useState } from 'react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cartCounts } from '@/lib/pos/grid'
import { clearCover, coverStartStore, needsCoverQuestion, readCover, saveCover } from '@/lib/pos/cover'
import { sofiaToday } from '@/lib/date-utils'

interface POSClientProps {
  products: Product[]
  categories: { id: string; name: string }[]
  frequentlySold: Product[]
  stores: { id: string; name: string }[]
  defaultStoreId: string
  outOfStock?: Product[]
  /** The seller's own store (Настройки → Потребители); null for an admin looking as a seller. */
  homeStoreId?: string | null
  userId?: string
}

function coverStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function POSClient({ products, categories, frequentlySold, stores, defaultStoreId, outOfStock, homeStoreId = null, userId = '' }: POSClientProps) {
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
  // "Замествате ли днес в …?" (src/lib/pos/cover.ts): the payment method waiting for the answer.
  const [coverAsk, setCoverAsk] = useState<string | null>(null)

  // Standing in somewhere today: the till opens on that store.
  useEffect(() => {
    if (!userId) return
    const to = coverStartStore({
      urlStoreId: new URLSearchParams(window.location.search).get('store'),
      homeStoreId,
      confirmedStoreId: readCover(coverStorage(), userId, sofiaToday()),
      storeIds: stores.map(s => s.id),
    })
    // Reads localStorage, so it can only run after mount; switches the till once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (to && to !== selectedStoreId) handleStoreChange(to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inCart = cartCounts(cart.items)

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

    if (userId && needsCoverQuestion({ homeStoreId, storeId: selectedStoreId, confirmedStoreId: readCover(coverStorage(), userId, sofiaToday()) })) {
      setShowPaymentPopup(false)
      setCoverAsk(method)
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
      // Back in the home store: the standing-in is over for today.
      if (userId && selectedStoreId === homeStoreId) clearCover(coverStorage(), userId, sofiaToday())
    } catch (err: any) {
      toast({ title: err.message || 'Грешка при записване', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Desktop layout: products flow naturally, cart fixed on right */}
      <div className="hidden lg:block">
        <div className="mr-[412px]">
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
            inCart={inCart}
          />
        </div>
        <div className="hidden lg:block fixed right-6 top-6 bottom-6 w-[380px]">
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
      <div className="lg:hidden pb-20">
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
          inCart={inCart}
        />
        <div className="fixed bottom-[var(--bottom-nav-h)] left-0 right-0 z-30">
          <CartBottomBar
            items={cart.items}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onSetQty={handleSetQty}
            onSubmit={method => handleSubmit(method)}
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
      <Dialog open={coverAsk !== null} onOpenChange={o => { if (!o) setCoverAsk(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Замествате ли днес в {storeName(stores, selectedStoreId)}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Вашият магазин е {storeName(stores, homeStoreId)}. Ако кажете „Да“, продажбите днес се записват в {storeName(stores, selectedStoreId)} и няма да питаме отново до утре.
          </p>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
            <Button className="h-11 sm:flex-1" data-testid="cover-yes" onClick={() => {
              const method = coverAsk
              saveCover(coverStorage(), userId, sofiaToday(), selectedStoreId)
              setCoverAsk(null)
              if (method) handleSubmit(method)
            }}>
              Да, замествам днес
            </Button>
            <Button variant="outline" className="h-11 sm:flex-1" data-testid="cover-no" onClick={() => {
              setCoverAsk(null)
              if (homeStoreId) handleStoreChange(homeStoreId)
            }}>
              Не, върни {storeName(stores, homeStoreId)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function storeName(stores: { id: string; name: string }[], id: string | null): string {
  return stores.find(st => st.id === id)?.name ?? 'друг магазин'
}
