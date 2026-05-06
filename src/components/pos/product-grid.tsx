// src/components/pos/product-grid.tsx

'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Package, Star } from 'lucide-react'
import { Product } from './cart-types'

interface ProductGridProps {
  products: Product[]
  categories: { id: string; name: string }[]
  frequentlySold: Product[]
  onAddToCart: (product: Product) => void
}

export function ProductGrid({ products, categories, frequentlySold, onAddToCart }: ProductGridProps) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const filtered = products.filter(p => {
    if (selectedCategory && p.category_id !== selectedCategory) return false
    if (search.length >= 2) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button
          variant={selectedCategory === null ? 'default' : 'outline'}
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => setSelectedCategory(null)}
        >
          Всички
        </Button>
        {categories.map(cat => (
          <Button
            key={cat.id}
            variant={selectedCategory === cat.id ? 'default' : 'outline'}
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.name}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Търсене по име или баркод..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          autoComplete="off"
        />
      </div>

      {/* Frequently sold */}
      {frequentlySold.length > 0 && !search && !selectedCategory && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Star className="h-3 w-3" /> Често продавани
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {frequentlySold.map(product => (
              <button
                key={product.id}
                className="flex items-center gap-2 shrink-0 rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors"
                onClick={() => onAddToCart(product)}
              >
                {product.image_url ? (
                  <img src={product.image_url} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">{product.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {product.price != null ? `${product.price.toFixed(2)} €` : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Product grid */}
      <div className="overflow-auto h-[calc(100vh-20rem)]">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            {search.length >= 2
              ? `Няма съвпадения за "${search}"`
              : 'Няма налични продукти'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map(product => (
              <button
                key={product.id}
                className="rounded-lg border bg-white p-3 text-left hover:shadow-md hover:border-slate-300 transition-all"
                onClick={() => onAddToCart(product)}
              >
                <div className="aspect-square bg-slate-100 rounded-md mb-2 flex items-center justify-center overflow-hidden">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <p className="text-sm font-medium truncate">{product.name}</p>
                <p className="text-sm font-semibold tabular-nums">
                  {product.price != null ? `${product.price.toFixed(2)} €` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {product.quantity_on_hand} бр.
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
