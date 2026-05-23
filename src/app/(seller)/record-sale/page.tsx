import { requireAuth, getEffectiveRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
import { createAdminClient } from '@/lib/supabase/admin'
import { POSClient } from '@/components/pos/pos-client'
import { Product } from '@/components/pos/cart-types'
import { AlertTriangle } from 'lucide-react'

type Store = { id: string; name: string }

interface PageProps {
  searchParams: Promise<{ store?: string }>
}

export default async function RecordSalePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const admin = createAdminClient()

  // Fetch stores
  const { data: stores } = await (admin.from('stores') as any)
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (!stores || stores.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>Няма налични обекти. Свържете се с администратор.</p>
      </div>
    )
  }

  // Default store resolution — URL param overrides
  let defaultStoreId = sp.store || user.store_id
  if (!defaultStoreId && user.role === 'admin' && effectiveRole === 'seller') {
    defaultStoreId = stores[0].id
  }
  if (!defaultStoreId) {
    defaultStoreId = stores[0].id
  }

  // Validate selected store exists and is active
  const selectedStore = stores.find((s: any) => s.id === defaultStoreId)
  if (selectedStore) defaultStoreId = selectedStore.id

  // Get products with stock in THIS store from stock_batches (admin bypasses RLS)
  const { data: storeBatches } = await (admin.from('stock_batches') as any)
    .select('product_id, quantity_remaining')
    .eq('store_id', defaultStoreId)
    .gt('quantity_remaining', 0)

  const storeProductIds = new Set((storeBatches || []).map((b: any) => b.product_id))
  const perStoreQty: Record<string, number> = {}
  ;(storeBatches || []).forEach((b: any) => {
    perStoreQty[b.product_id] = (perStoreQty[b.product_id] || 0) + b.quantity_remaining
  })

  // Fetch ALL active products (filter stock in JS to avoid PostgREST URI limit)
  const { data: allActiveProducts } = await (admin.from('products') as any)
    .select('id, name, price, quantity_on_hand, category_id')
    .eq('status', 'active')
    .order('name')

  // Split into in-stock vs out-of-stock for this store
  const products = (allActiveProducts || []).filter((p: any) => storeProductIds.has(p.id))
  const outOfStockProducts = (allActiveProducts || []).filter((p: any) => !storeProductIds.has(p.id))

  // Sort by sales frequency for this store (most sold first, unsold alphabetical)
  const { data: storeSalesCounts } = await (admin.from('sales') as any)
    .select('product_id')
    .eq('store_id', defaultStoreId)
    .eq('voided', false)
    .gte('sale_date', new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0])

  const salesCountMap: Record<string, number> = {}
  ;(storeSalesCounts || []).forEach((s: any) => {
    salesCountMap[s.product_id] = (salesCountMap[s.product_id] || 0) + 1
  })

  const sortedProducts = (products || []).sort((a: any, b: any) => {
    const aCount = salesCountMap[a.id] || 0
    const bCount = salesCountMap[b.id] || 0
    if (aCount !== bCount) return bCount - aCount
    return (a.name || '').localeCompare(b.name || '')
  })

  // Out-of-stock: all active products NOT in stock for this store
  const outOfStockProductsWithMeta = (outOfStockProducts || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    quantity_on_hand: 0,
    category_id: p.category_id,
    image_url: null,
  }))

  // Fetch categories
  const { data: categories } = await (admin.from('categories') as any)
    .select('id, name')
    .order('name')

  // Fetch all primary images (avoid IN filter URI limit)
  const { data: images } = await (admin.from('product_images') as any)
    .select('product_id, url')
    .eq('is_primary', true)

  const imageMap: Record<string, string> = {}
  ;(images || []).forEach((img: any) => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = img.url
  })

  // Add images to outOfStock
  const outOfStockFinal = outOfStockProductsWithMeta.map((p: any) => ({
    ...p,
    image_url: imageMap[p.id] || null,
  }))

  const productsWithImages: Product[] = (sortedProducts || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    quantity_on_hand: perStoreQty[p.id] || p.quantity_on_hand,
    category_id: p.category_id,
    image_url: imageMap[p.id] || null,
  }))

  // Frequently sold: seller's last unique products + fill from store products
  let frequentlySold: Product[] = []

  const { data: recentSales } = await (admin.from('sales') as any)
    .select('product_id')
    .eq('sold_by', user.id)
    .eq('voided', false)
    .order('created_at', { ascending: false })
    .limit(20)

  if (recentSales && recentSales.length > 0) {
    const seenIds = new Set<string>()
    const uniqueProductIds = recentSales
      .map((s: any) => s.product_id)
      .filter((id: string) => {
        if (seenIds.has(id)) return false
        seenIds.add(id)
        return true
      })
      .slice(0, 6)

    const sellerFreq = productsWithImages.filter(p => uniqueProductIds.includes(p.id))
    const remaining = 12 - sellerFreq.length

    if (remaining > 0) {
      const sellerFreqIds = new Set(sellerFreq.map(p => p.id))
      const storeFreq = productsWithImages
        .filter(p => !sellerFreqIds.has(p.id))
        .slice(0, remaining)

      frequentlySold = [...sellerFreq, ...storeFreq]
    } else {
      frequentlySold = sellerFreq
    }
  }

  return (
    <POSClient
      products={productsWithImages}
      categories={(categories || []) as { id: string; name: string }[]}
      frequentlySold={frequentlySold}
      stores={stores as Store[]}
      defaultStoreId={defaultStoreId!}
      outOfStock={outOfStockFinal as Product[]}
    />
  )
}
