'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Search, CheckCircle, Loader2 } from 'lucide-react'

type Product = {
  id: string
  name: string
  price: number | null
  quantity_on_hand: number
  image_url?: string | null
}

interface SaleEntryProps {
  storeId: string
  userId: string
}

export default function SaleEntry({ storeId, userId }: SaleEntryProps) {
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  const [selected, setSelected] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [salePrice, setSalePrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  // Debounced search
  useEffect(() => {
    if (search.length < 2) {
      setResults([])
      setShowDropdown(false)
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('products')
          .select('id, name, price, quantity_on_hand')
          .ilike('name', `%${search}%`)
          .eq('status', 'listed')
          .order('name')
          .limit(10)

        if (error) throw error

        const products: Product[] = (data || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          quantity_on_hand: p.quantity_on_hand,
        }))

        // Fetch primary images in a separate query
        if (products.length > 0) {
          const productIds = products.map((p) => p.id)
          const { data: images } = await supabase
            .from('product_images')
            .select('product_id, url')
            .in('product_id', productIds)
            .eq('is_primary', true)

          const imageMap: Record<string, string> = {}
          ;(images || []).forEach((img: any) => {
            if (!imageMap[img.product_id]) {
              imageMap[img.product_id] = img.url
            }
          })
          products.forEach((p) => {
            p.image_url = imageMap[p.id] || null
          })
        }

        setResults(products)
        setShowDropdown(true)
      } catch (err) {
        console.error('Search error:', err)
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [search])

  const handleSelect = useCallback((product: Product) => {
    setSelected(product)
    setSalePrice(product.price?.toString() || '')
    setQuantity('1')
    setSearch('')
    setShowDropdown(false)
    setSuccess(false)
  }, [])

  const handleSave = async () => {
    if (!selected) return

    const qty = parseInt(quantity)
    if (!qty || qty < 1) {
      toast({ title: 'Моля въведете валидно количество', variant: 'destructive' })
      return
    }

    const price = parseFloat(salePrice)
    if (!price || price < 0) {
      toast({ title: 'Моля въведете валидна цена', variant: 'destructive' })
      return
    }

    if (qty > selected.quantity_on_hand) {
      toast({ title: 'Недостатъчна наличност', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      // Supabase type inference broken — use any
      const db = createClient() as any

      const { error: insertError } = await db
        .from('sales')
        .insert({
          product_id: selected.id,
          store_id: storeId,
          sold_by: userId,
          quantity: qty,
          sale_price: price,
          sale_date: new Date().toISOString().split('T')[0],
        })

      if (insertError) throw insertError

      // Decrement stock
      const { error: updateError } = await db
        .from('products')
        .update({ quantity_on_hand: selected.quantity_on_hand - qty })
        .eq('id', selected.id)

      if (updateError) throw updateError

      toast({ title: 'Продажбата е записана' })
      setSuccess(true)
      setSelected(null)
      setQuantity('1')
      setSalePrice('')
    } catch (err) {
      console.error('Save error:', err)
      toast({ title: 'Грешка при записване', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setSelected(null)
    setSearch('')
    setQuantity('1')
    setSalePrice('')
    setResults([])
    setShowDropdown(false)
    setSuccess(false)
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Запиши продажба</h1>
        <p className="text-muted-foreground mt-1">Бързо въвеждане на продажба чрез търсене на продукт</p>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 p-4 text-green-800">
          <CheckCircle className="h-5 w-5" />
          <span>Продажбата е записана успешно</span>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Търсене на продукт по име..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoComplete="off"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Dropdown */}
        {showDropdown && results.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
            {results.map((product) => (
              <button
                key={product.id}
                type="button"
                className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => handleSelect(product)}
              >
                {product.image_url ? (
                  <img src={product.image_url} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                    НЯМА
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.price ? `${product.price.toFixed(2)} лв` : 'Без цена'} &middot; Наличност: {product.quantity_on_hand}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {showDropdown && search.length >= 2 && results.length === 0 && !searching && (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg p-3 text-sm text-muted-foreground text-center">
            Няма намерени продукти
          </div>
        )}
      </div>

      {/* Selected product card */}
      {selected && (
        <div className="rounded-lg border bg-white p-4 space-y-4">
          <div className="flex gap-4">
            {selected.image_url ? (
              <img src={selected.image_url} alt={selected.name} className="h-24 w-24 rounded object-cover" />
            ) : (
              <div className="h-24 w-24 rounded bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
                Няма снимка
              </div>
            )}
            <div className="flex-1">
              <h3 className="font-semibold text-lg">{selected.name}</h3>
              <p className="text-sm text-muted-foreground">
                Каталожна цена: {selected.price ? `${selected.price.toFixed(2)} лв` : 'Няма'}
              </p>
              <p className="text-sm text-muted-foreground">
                Наличност: <span className={selected.quantity_on_hand === 0 ? 'text-red-600 font-medium' : ''}>
                  {selected.quantity_on_hand}
                </span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Количество</label>
              <Input
                type="number"
                min={1}
                max={selected.quantity_on_hand}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Цена на продажба (лв)</label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleReset}>
              Отказ
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Записване...
                </>
              ) : (
                'Запиши продажба'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
