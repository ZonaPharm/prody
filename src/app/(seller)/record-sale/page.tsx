import { requireAuth, getEffectiveRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { POSClient } from '@/components/pos/pos-client'
import { Product } from '@/components/pos/cart-types'
import { AlertTriangle } from 'lucide-react'

type Store = { id: string; name: string }

export default async function RecordSalePage() {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()

  // Fetch stores
  const { data: stores } = await (supabase.from('stores') as any)
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

  // Fetch listed products
  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, price, quantity_on_hand, category_id')
    .eq('status', 'active')
    .order('name')

  // Fetch categories
  const { data: categories } = await (supabase.from('categories') as any)
    .select('id, name')
    .order('name')

  // Fetch primary images for all products
  const productIds = (products || []).map((p: any) => p.id)
  const { data: images } = productIds.length > 0
    ? await (supabase.from('product_images') as any)
        .select('product_id, url')
        .in('product_id', productIds)
        .eq('is_primary', true)
    : { data: [] }

  const imageMap: Record<string, string> = {}
  ;(images || []).forEach((img: any) => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = img.url
  })

  const productsWithImages: Product[] = (products || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    quantity_on_hand: p.quantity_on_hand,
    category_id: p.category_id,
    image_url: imageMap[p.id] || null,
  }))

  // Frequently sold: seller's last unique products + fill from store products
  let frequentlySold: Product[] = []

  const { data: recentSales } = await (supabase.from('sales') as any)
    .select('product_id')
    .eq('sold_by', user.id)
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

  // Default store resolution (same logic as before)
  let defaultStoreId = user.store_id

  if (!defaultStoreId && user.role === 'admin' && effectiveRole === 'seller') {
    defaultStoreId = stores[0].id
  }

  if (!defaultStoreId) {
    defaultStoreId = stores[0].id
  }

  return (
    <POSClient
      products={productsWithImages}
      categories={(categories || []) as { id: string; name: string }[]}
      frequentlySold={frequentlySold}
      stores={stores as Store[]}
      defaultStoreId={defaultStoreId!}
    />
  )
}
