'use client'

import { useEffect, useRef, useState } from 'react'
import type { StoreStockMap } from '@/lib/deliveries/store-stock'

/**
 * What each store holds now of these products, loaded once per product
 * (new lines fetch only their own). A failed load shows nothing: the
 * distribution works without it.
 */
export function useStoreStock(productIds: string[]) {
  const [stock, setStock] = useState<StoreStockMap>({})
  const [min, setMin] = useState<Record<string, number | null>>({})
  const asked = useRef(new Set<string>())
  const key = [...new Set(productIds)].sort().join(',')

  useEffect(() => {
    const missing = key ? key.split(',').filter(id => !asked.current.has(id)) : []
    if (missing.length === 0) return
    // A short wait so several lines added at once ("Каталог") go in one request.
    const timer = setTimeout(async () => {
      missing.forEach(id => asked.current.add(id))
      try {
        const res = await fetch(`/api/deliveries/products/store-stock?ids=${missing.join(',')}`)
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json() as { stock: StoreStockMap; min: Record<string, number | null> }
        setStock(prev => ({ ...prev, ...data.stock }))
        setMin(prev => ({ ...prev, ...data.min }))
      } catch {
        // Let a later change ask again.
        missing.forEach(id => asked.current.delete(id))
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [key])

  return { stock, min }
}
