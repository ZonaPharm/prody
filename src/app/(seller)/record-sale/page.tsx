import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canSell, homePath } from '@/lib/roles'

export const dynamic = 'force-dynamic'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/fetch-all'
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
  // Офис or a driver without the Продавач role does not sell.
  if (!canSell(user)) redirect(homePath(user))
  const admin = createAdminClient()

  // PostgREST returns at most 1000 rows per request and says nothing when it
  // stops there, so every list below that can grow past it is read page by
  // page (fetchAll), ordered down to the id so the pages neither overlap nor
  // skip. On 9 November 2026 90 days of sales were 1499 rows at Заимов and
  // 1355 at Ботев, so their "most sold first" order was worked out from an
  // arbitrary 1000; active products (777) and primary images (833) were
  // heading for the same cut, past which products would simply have vanished
  // from the till.
  //
  // Every read is a round trip to the database, and the till used to make them
  // one after another, so it waited for the sum of them. The reads do not
  // depend on each other, so they go out together. Only the store has to be
  // known first: it comes from the URL or the seller's own store, and only
  // without both does it wait for the list of stores (the first active one).

  const storesRead: Promise<Store[] | null> = (admin.from('stores') as any)
    .select('id, name')
    .eq('is_active', true)
    .order('name')
    .then((r: { data: Store[] | null }) => r.data)

  const wantedStoreId = sp.store || user.store_id
  const storeIdRead: Promise<string | null> = wantedStoreId
    ? Promise.resolve(wantedStoreId)
    : storesRead.then(s => s?.[0]?.id ?? null)

  const [
    stores,
    storeBatches,
    allActiveProducts,
    storeSalesCounts,
    { data: categories },
    images,
    { data: recentSales },
  ] = await Promise.all([
    storesRead,
    // Products with stock in THIS store from stock_batches (admin bypasses RLS)
    storeIdRead.then(storeId => storeId
      ? fetchAll<{ product_id: string; quantity_remaining: number }>(() => (admin.from('stock_batches') as any)
        .select('product_id, quantity_remaining')
        .eq('store_id', storeId)
        .gt('quantity_remaining', 0)
        .order('id'))
      : []),
    // ALL active products (filter stock in JS to avoid PostgREST URI limit)
    fetchAll<{ id: string; name: string; price: number | null; quantity_on_hand: number; category_id: string | null }>(() => (admin.from('products') as any)
      .select('id, name, price, quantity_on_hand, category_id')
      .eq('status', 'active')
      .order('name')
      .order('id')),
    // Sales frequency for this store (most sold first, unsold alphabetical).
    // Only the order depends on it, so a failure leaves the till alphabetical
    // rather than taking it down.
    storeIdRead.then(storeId => storeId
      ? fetchAll<{ product_id: string }>(() => (admin.from('sales') as any)
        .select('product_id')
        .eq('store_id', storeId)
        .eq('voided', false)
        .gte('sale_date', new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0])
        .order('id'))
      : [])
      .catch((err: unknown) => { console.error('record-sale: sales counts', err); return [] as { product_id: string }[] }),
    (admin.from('categories') as any)
      .select('id, name')
      .order('name'),
    // All primary images (avoid IN filter URI limit). Pictures only: on a
    // failure the till still sells, just without them.
    fetchAll<{ product_id: string; url: string }>(() => (admin.from('product_images') as any)
      .select('product_id, url')
      .eq('is_primary', true)
      .order('id'))
      .catch((err: unknown) => { console.error('record-sale: images', err); return [] as { product_id: string; url: string }[] }),
    // The seller's last sales, for "frequently sold" below.
    (admin.from('sales') as any)
      .select('product_id')
      .eq('sold_by', user.id)
      .eq('voided', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (!stores || stores.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>Няма налични обекти. Свържете се с администратор.</p>
      </div>
    )
  }

  const defaultStoreId = (await storeIdRead) as string

  const storeProductIds = new Set((storeBatches || []).map((b: any) => b.product_id))
  const perStoreQty: Record<string, number> = {}
  ;(storeBatches || []).forEach((b: any) => {
    perStoreQty[b.product_id] = (perStoreQty[b.product_id] || 0) + b.quantity_remaining
  })

  // Split into in-stock vs out-of-stock for this store
  const products = (allActiveProducts || []).filter((p: any) => storeProductIds.has(p.id))
  const outOfStockProducts = (allActiveProducts || []).filter((p: any) => !storeProductIds.has(p.id))

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
      homeStoreId={user.store_id}
      userId={user.id}
      outOfStock={outOfStockFinal as Product[]}
    />
  )
}
