'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
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

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)

    const params = new URLSearchParams({ offset: String(products.length), limit: '50' })
    if (filters.search) params.set('search', filters.search)
    if (filters.status) params.set('status', filters.status)
    if (filters.sort) params.set('sort', filters.sort)
    if (filters.category) params.set('category', filters.category)
    if (filters.store) params.set('store', filters.store)

    try {
      const res = await fetch(`/api/products/load-more?${params}`)
      const data = await res.json()
      setProducts(prev => [...prev, ...(data.products || [])])
      setHasMore(data.hasMore)
    } catch {
      // retry on next scroll
    } finally {
      setLoading(false)
    }
  }, [products.length, hasMore, loading, filters])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const ob = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { rootMargin: '200px' }
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [loadMore])

  // Reset when filters change (initial products are new)
  useEffect(() => {
    setProducts(initialProducts)
    setHasMore(initialHasMore)
  }, [initialProducts, initialHasMore])

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {products.map((product: any) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {/* Sentinel element for intersection observer */}
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
