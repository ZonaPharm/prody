import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { LowStockClient } from './low-stock-client'

export const dynamic = 'force-dynamic'

export default async function LowStockPage() {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()

  let storeId = user.store_id

  // Admin impersonating: get first active non-warehouse store
  if (!storeId && user.role === 'admin' && effectiveRole === 'seller') {
    const { data: stores } = await (supabase.from('stores') as any)
      .select('id, is_warehouse')
      .eq('is_active', true)
      .order('name')
    const store = (stores || []).find((s: any) => !s.is_warehouse) || (stores || [])[0]
    if (store) storeId = store.id
  }

  if (!storeId) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Нямате зададен магазин
      </div>
    )
  }

  // Get products with batches in this store (including zero)
  const { data: batches } = await (supabase.from('stock_batches') as any)
    .select('product_id, quantity_remaining')
    .eq('store_id', storeId)

  const productQtys: Record<string, number> = {}
  ;(batches || []).forEach((b: any) => {
    productQtys[b.product_id] = (productQtys[b.product_id] || 0) + b.quantity_remaining
  })

  // Get product details
  const productIds = Object.keys(productQtys)
  const { data: products } = productIds.length > 0
    ? await (supabase.from('products') as any)
        .select('id, name, price, min_quantity, category:categories(name)')
        .in('id', productIds)
        .order('name')
    : { data: [] }

  const items = (products || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.category?.name || (Array.isArray(p.category) ? p.category[0]?.name : null),
    min_quantity: p.min_quantity || 5,
    current_qty: productQtys[p.id] || 0,
  })).filter((p: any) => p.current_qty <= p.min_quantity)
    .sort((a: any, b: any) => a.current_qty - b.current_qty)

  // Fetch all active products for search
  const { data: allProducts } = await (supabase.from('products') as any)
    .select('id, name, price, min_quantity, category:categories(name)')
    .eq('status', 'active')
    .order('name')

  // Fetch product images
  const allIds = [...items.map(i => i.id), ...(allProducts || []).map((p: any) => p.id)]
  const { data: images } = allIds.length > 0 ? await (supabase.from('product_images') as any)
    .select('product_id, url')
    .in('product_id', allIds)
    .eq('is_primary', true)
    : { data: [] }

  const imageMap: Record<string, string> = {}
  ;(images || []).forEach((img: any) => { if (!imageMap[img.product_id]) imageMap[img.product_id] = img.url })

  return <LowStockClient items={items} storeId={storeId} allProducts={allProducts || []} imageMap={imageMap} />
}
