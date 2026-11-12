import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LowStockClient } from './low-stock-client'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { getOfficeStock, notRequestableReason, type OfficeStockMap } from '@/lib/requests/office-stock'

export const dynamic = 'force-dynamic'

export default async function LowStockPage() {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()
  const admin = createAdminClient()

  let storeId = user.store_id

  // Admin impersonating: get first active non-warehouse store
  if (!storeId && user.role === 'admin' && effectiveRole === 'seller') {
    const { data: stores } = await (admin.from('stores') as any)
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

  // Every read is a round trip to the database. The page used to make them one
  // after another; now what does not depend on anything else goes out together
  // (this store's batches, free Офис stock, the primary pictures), and then the
  // two product lists that need the ids from the first round.
  const [batches, officeStock, primaryImages] = await Promise.all([
    // Products with batches in this store (including zero)
    fetchAll<any>(() => (admin.from('stock_batches') as any)
      .select('id, product_id, quantity_remaining')
      .eq('store_id', storeId)
      .order('id')),
    // A store asks only for what Офис can send now (free Офис stock).
    getOfficeStock(admin).catch((e: unknown) => {
      console.error('low-stock: office stock failed:', e instanceof Error ? e.message : JSON.stringify(e))
      return {} as OfficeStockMap
    }),
    // All primary pictures in one read (about 830 rows), instead of looking
    // them up by id in chunks after the products are known.
    fetchAll<{ product_id: string; url: string }>(() => (admin.from('product_images') as any)
      .select('product_id, url')
      .eq('is_primary', true)
      .order('id')),
  ])

  const productQtys: Record<string, number> = {}
  ;(batches || []).forEach((b: any) => {
    productQtys[b.product_id] = (productQtys[b.product_id] || 0) + b.quantity_remaining
  })

  const productIds = Object.keys(productQtys)
  // Products for search: only what Офис can send now.
  const freeIds = Object.keys(officeStock).filter(id => officeStock[id].free > 0)
  const [storeProducts, freeProducts] = await Promise.all([
    // Product details
    fetchByIds<any>(
      ids => (admin.from('products') as any)
        .select('id, name, price, min_quantity, category:categories(name)')
        .in('id', ids),
      productIds,
    ),
    fetchByIds<any>(
      ids => (admin.from('products') as any)
        .select('id, name, price, min_quantity, category:categories(name)')
        .eq('status', 'active')
        .in('id', ids),
      freeIds,
    ),
  ])
  const products = storeProducts.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'bg'))

  const items = (products || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.category?.name || (Array.isArray(p.category) ? p.category[0]?.name : null),
    min_quantity: p.min_quantity || 5,
    current_qty: productQtys[p.id] || 0,
    office_qty: officeStock[p.id]?.free ?? 0,
    office_reason: notRequestableReason(officeStock[p.id]),
  })).filter((p: any) => p.current_qty <= p.min_quantity)
    .sort((a: any, b: any) => a.current_qty - b.current_qty)

  const allProducts = freeProducts
    .map((p: any) => ({ ...p, office_qty: officeStock[p.id].free }))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'bg'))

  // Pictures of the products on the page only.
  const allIds = new Set([...items.map((i: any) => i.id), ...allProducts.map((p: any) => p.id)])
  const imageMap: Record<string, string> = {}
  ;(primaryImages || []).forEach((img: any) => {
    if (allIds.has(img.product_id) && !imageMap[img.product_id]) imageMap[img.product_id] = img.url
  })

  return <LowStockClient items={items} storeId={storeId} allProducts={allProducts} imageMap={imageMap} />
}
