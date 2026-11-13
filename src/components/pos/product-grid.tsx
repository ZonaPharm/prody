// src/components/pos/product-grid.tsx

'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Package, Star, Send, Plus } from 'lucide-react'
import { Note } from '@/components/ui/text'
import { Product } from './cart-types'
import { getImageSrc } from '@/lib/images'
import { looksLikeCode, matchesCode } from '@/lib/barcodes'
import { findByScan, ScanBuffer } from '@/lib/barcodes/scan'
import { TILL_PAGE, visiblePart } from '@/lib/pos/grid'
import { cn } from '@/lib/utils'

interface ProductGridProps {
  products: Product[]
  categories: { id: string; name: string }[]
  frequentlySold: Product[]
  onAddToCart: (product: Product) => void
  outOfStock?: Product[]
  /** Pieces of each product already in the cart (src/lib/pos/grid.ts cartCounts). */
  inCart?: Record<string, number>
}

export function ProductGrid({ products, categories, frequentlySold, onAddToCart, outOfStock, inCart = {} }: ProductGridProps) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  // Drawn a page at a time (src/lib/pos/grid.ts); a new search or category starts again at the top.
  const [limit, setLimit] = useState(TILL_PAGE)
  const [lastFilter, setLastFilter] = useState('')
  const filterKey = `${search}|${selectedCategory ?? ''}`
  if (filterKey !== lastFilter) {
    setLastFilter(filterKey)
    setLimit(TILL_PAGE)
  }
  const moreRef = useRef<HTMLDivElement>(null)

  const matches = (p: Product) => {
    if (selectedCategory && p.category_id !== selectedCategory) return false
    if (search.length >= 2) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q) && !matchesCode(p, search)) return false
    }
    return true
  }

  // A scan (from the search box, or typed by the scanner with no field focused):
  // the product goes straight into the cart, whatever category is picked.
  const handleScan = (code: string) => {
    const r = findByScan(code, products, outOfStock || [])
    if (r.kind === 'add') {
      onAddToCart(r.product)
      setNotice({ ok: true, text: `Добавен: ${r.product.name}` })
    } else if (r.kind === 'out') {
      setNotice({ ok: false, text: `${r.product.name}: изчерпан в този магазин` })
    } else {
      setNotice({ ok: false, text: `Няма продукт с баркод ${r.code}. Потърсете го по име.` })
    }
    setSearch('')
  }
  const scanRef = useRef(handleScan)
  scanRef.current = handleScan
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const buffer = new ScanBuffer()
    const onKey = (e: KeyboardEvent) => {
      // The till renders this grid twice (phone and desktop layouts); only the one
      // on screen takes the scan, or the product would go into the cart twice.
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) {
        buffer.reset()
        return
      }
      const code = buffer.key(e.key, e.timeStamp || Date.now())
      if (code) {
        e.preventDefault()
        scanRef.current(code)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const filtered = products.filter(matches)

  // Out-of-stock products go through the same search and category filter.
  // They used to be shown only while nothing was typed: the moment a seller
  // searched for a product that had run out in their shop, it vanished and
  // the screen said "no matches", as if the item did not exist — which is
  // exactly when they need its exact name to request more.
  const filteredOut = (outOfStock || []).filter(matches)

  // In stock first, then the sold-out ones, one page at a time.
  const inStock = visiblePart(filtered, limit)
  const soldOut = visiblePart(filteredOut, Math.max(0, limit - filtered.length))
  const more = inStock.more + soldOut.more

  // Reaching the end of the list draws the next page; the button below does the same by hand.
  useEffect(() => {
    const el = moreRef.current
    if (!el || more === 0 || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setLimit(l => l + TILL_PAGE)
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, limit])

  return (
    <div ref={rootRef} className="space-y-3 lg:space-y-4">
      {/* Search and categories stay at the top while the list scrolls (under the phone's top bar). */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] lg:top-0 z-20 -mx-4 px-4 lg:mx-0 lg:px-0 py-2 lg:py-0 bg-slate-50/95 lg:bg-transparent backdrop-blur lg:backdrop-blur-none space-y-2 lg:static lg:space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Търсене по име или сканирайте баркод..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && looksLikeCode(search)) {
                e.preventDefault()
                handleScan(search)
              }
            }}
            className="pl-9 h-11 text-base lg:h-10 lg:text-sm bg-white"
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>

        {/* Category pills */}
        <div className="no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0 flex gap-2 overflow-x-auto">
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
      </div>

      {notice && (
        <div role="status">
          <Note tone={notice.ok ? 'success' : 'warn'}>{notice.text}</Note>
        </div>
      )}

      {/* Frequently sold */}
      {frequentlySold.length > 0 && !search && !selectedCategory && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Star className="h-3 w-3" /> Често продавани
          </p>
          <div className="no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0 flex gap-2 overflow-x-auto pb-1">
            {frequentlySold.map(product => (
              <button
                key={product.id}
                className={cn(
                  'flex items-center gap-2 shrink-0 rounded-full border bg-white px-3 py-2 text-sm hover:bg-slate-50 active:bg-slate-100 transition-colors',
                  inCart[product.id] && 'border-emerald-400 bg-emerald-50',
                )}
                onClick={() => onAddToCart(product)}
              >
                {product.image_url ? (
                  <img src={getImageSrc(product.image_url)} alt="" className="h-6 w-6 rounded object-cover" />
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

      {/* Products: one row each on a phone (picture, name, price), cards from sm up */}
      <div>
        {filtered.length === 0 && filteredOut.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            {search.length >= 2
              ? `Няма съвпадения за "${search}"`
              : 'Няма налични продукти'}
          </div>
        ) : (
          <>
            {inStock.shown.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6 gap-2 sm:gap-3">
                {inStock.shown.map(product => {
                  const n = inCart[product.id] || 0
                  return (
                    <button
                      key={product.id}
                      data-testid="till-product"
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg border bg-white p-2 text-left transition-all active:scale-[0.99] active:bg-slate-50 sm:block sm:p-3 hover:shadow-md hover:border-slate-300',
                        n > 0 && 'border-emerald-400 ring-1 ring-emerald-400',
                      )}
                      onClick={() => onAddToCart(product)}
                    >
                      <div className="h-14 w-14 shrink-0 bg-slate-100 rounded-md flex items-center justify-center overflow-hidden sm:h-auto sm:w-full sm:aspect-square sm:mb-2">
                        {product.image_url ? (
                          <img src={getImageSrc(product.image_url)} alt="" loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="h-6 w-6 sm:h-8 sm:w-8 text-slate-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] sm:text-sm font-medium leading-tight line-clamp-2 sm:min-h-[2.5em]" title={product.name}>{product.name}</p>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-base sm:text-sm font-semibold tabular-nums">
                            {product.price != null ? `${product.price.toFixed(2)} €` : '—'}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {product.quantity_on_hand} бр.
                          </span>
                        </div>
                      </div>
                      {/* Phone: a clear "add" target on the right; it shows how many are in the cart once added. */}
                      <span className={cn(
                        'flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-sm font-semibold sm:hidden',
                        n > 0 ? 'bg-emerald-600 text-white' : 'bg-primary/10 text-primary',
                      )} aria-hidden>
                        {n > 0 ? `${n}` : <Plus className="h-5 w-5" />}
                      </span>
                      {n > 0 && (
                        <span className="absolute right-2 top-2 hidden rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white sm:block">
                          {n} в количката
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}

            {soldOut.shown.length > 0 && (
              <div className={filtered.length > 0 ? 'border-t pt-3 mt-3' : ''}>
                <p className="text-xs font-medium text-red-500 mb-2">
                  Изчерпани в този магазин ({filteredOut.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6 gap-2 sm:gap-3">
                  {soldOut.shown.map(product => (
                    <div
                      key={product.id}
                      className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50/30 p-2 text-left sm:block sm:p-3"
                    >
                      <div className="h-14 w-14 shrink-0 bg-slate-100 rounded-md flex items-center justify-center overflow-hidden opacity-60 sm:h-auto sm:w-full sm:aspect-square sm:mb-2">
                        {product.image_url ? (
                          <img src={getImageSrc(product.image_url)} alt="" loading="lazy" className="w-full h-full object-cover grayscale" />
                        ) : (
                          <Package className="h-6 w-6 sm:h-8 sm:w-8 text-slate-300" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] sm:text-sm font-medium leading-tight line-clamp-2 sm:min-h-[2.5em] text-slate-700" title={product.name}>{product.name}</p>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-sm font-semibold tabular-nums text-slate-400">
                            {product.price != null ? `${product.price.toFixed(2)} €` : '—'}
                          </span>
                          <span className="text-xs text-red-500 font-medium">Изчерпан</span>
                        </div>
                      </div>
                      {/* Straight into a request with this product already in the basket,
                          so nobody has to retype or guess the name. */}
                      <a
                        href={`/my-requests?tab=request&product=${product.id}`}
                        className="flex h-10 shrink-0 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:mt-2 sm:h-9 sm:w-full"
                      >
                        <Send className="h-4 w-4" /> Заяви
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {more > 0 && (
              <div ref={moreRef} className="pt-3 text-center">
                <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setLimit(l => l + TILL_PAGE)}>
                  Покажи още ({more})
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
