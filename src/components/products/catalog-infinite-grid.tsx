'use client'

import { useEffect, useRef, useState } from 'react'
import ProductCard from './product-card'

interface Props {
  initialProducts: any[]
  filters: Record<string, string>
  hasMore: boolean
}

export default function CatalogInfiniteGrid({ initialProducts, filters, hasMore: initialHasMore }: Props) {
  const [products, setProducts] = useState(initialProducts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Use refs to avoid stale closures in IntersectionObserver callback
  const loadingRef = useRef(false)
  const hasMoreRef = useRef(initialHasMore)
  const filtersRef = useRef(filters)
  const offsetRef = useRef(initialProducts.length)

  useEffect(() => { hasMoreRef.current = initialHasMore }, [initialHasMore])
  useEffect(() => { filtersRef.current = filters }, [filters])

  // Reset when filters change
  useEffect(() => {
    setProducts(initialProducts)
    setHasMore(initialHasMore)
    offsetRef.current = initialProducts.length
    loadingRef.current = false
    setLoading(false)
  }, [initialProducts, initialHasMore])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const ob = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return
        if (loadingRef.current || !hasMoreRef.current) return

        loadingRef.current = true
        setLoading(true)

        const f = filtersRef.current
        const requestOffset = offsetRef.current
        const params = new URLSearchParams({ offset: String(requestOffset), limit: '50' })
        if (f.search) params.set('search', f.search)
        if (f.status) params.set('status', f.status)
        if (f.sort) params.set('sort', f.sort)
        if (f.category) params.set('category', f.category)
        if (f.store) params.set('store', f.store)
        if (f.hasImages) params.set('hasImages', f.hasImages)
        if (f.wp) params.set('wp', f.wp)

        try {
          // Save scroll position before adding products to prevent layout jump
          const scrollY = window.scrollY

          const res = await fetch(`/api/products/load-more?${params}`)
          const data = await res.json()
          const fetched = data.products || []

          // The next page starts where this one ended. It used to be computed as
          // initialProducts.length + prev.length + fetched.length, but prev
          // already holds the initial products, so they were counted twice: the
          // second scroll asked for row 150 instead of 100 and rows 100-149
          // never loaded. Every list over 100 products lost exactly 50 — in
          // Бургас, 164 products showed as 114.
          //
          // Computed here rather than inside the setProducts updater, which
          // React may call twice in development.
          offsetRef.current = requestOffset + fetched.length

          setProducts(prev => [...prev, ...fetched])
          setHasMore(data.hasMore)
          hasMoreRef.current = data.hasMore

          // Restore scroll position after DOM update
          requestAnimationFrame(() => {
            window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })
          })
        } catch {
          // retry on next scroll
        } finally {
          loadingRef.current = false
          setLoading(false)
        }
      },
      { rootMargin: '500px' }
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [initialProducts.length]) // stable dependency — only remounts when page resets

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {products.map((product: any) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      <div ref={sentinelRef} className="h-10 flex items-center justify-center">
        {loading && (
          <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full" />
        )}
        {!hasMore && products.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {products.length} продукт{products.length === 1 ? '' : 'а'} показан{products.length === 1 ? '' : 'и'}
          </p>
        )}
      </div>
    </>
  )
}
