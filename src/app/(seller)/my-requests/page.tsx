import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MyRequestsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function MyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()
  const admin = createAdminClient()
  const sp = await searchParams
  const activeTab = sp.tab || 'request'

  // Resolve store_id (admins impersonating sellers may not have one)
  let storeId = user.store_id
  if (!storeId && user.role === 'admin' && effectiveRole === 'seller') {
    const { data: stores } = await (admin.from('stores') as any)
      .select('id, is_warehouse').eq('is_active', true).order('name')
    const store = (stores || []).find((s: any) => !s.is_warehouse) || (stores || [])[0]
    if (store) storeId = store.id
  }

  // Products for request form (with images + categories for grid view)
  const [{ data: products }, { data: categories }, { data: images }] = await Promise.all([
    (admin.from('products') as any).select('id, name, price, quantity_on_hand, category_id').eq('status', 'active').order('name'),
    (admin.from('categories') as any).select('id, name').order('name'),
    (admin.from('product_images') as any).select('product_id, url').eq('is_primary', true),
  ])

  const imageMap: Record<string, string> = {}
  ;(images || []).forEach((img: any) => { if (!imageMap[img.product_id]) imageMap[img.product_id] = img.url })

  // My requests
  let myRequests: any[] = []
  if (activeTab === 'my') {
    const { data } = await (admin.from('stock_requests') as any)
      .select('id, product:products(name), requested_qty, status, notes, created_at, accepted_at, in_transit_at, delivered_at')
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    myRequests = (data || []).map((r: any) => ({
      id: r.id,
      product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
      quantity: r.requested_qty,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at,
      accepted_at: r.accepted_at,
      in_transit_at: r.in_transit_at,
      delivered_at: r.delivered_at,
    }))
  }

  // Low stock data
  let lowStockItems: any[] = []
  let lowStockAllProducts: any[] = []
  let lowStockImageMap: Record<string, string> = {}
  if (activeTab === 'low') {
    if (storeId) {
      const { data: batches } = await (admin.from('stock_batches') as any)
        .select('product_id, quantity_remaining').eq('store_id', storeId)
      const productQtys: Record<string, number> = {}
      ;(batches || []).forEach((b: any) => { productQtys[b.product_id] = (productQtys[b.product_id] || 0) + b.quantity_remaining })

      const productIds = Object.keys(productQtys)
      const { data: lowProducts } = productIds.length > 0
        ? await (admin.from('products') as any).select('id, name, price, min_quantity, category:categories(name)').in('id', productIds).order('name')
        : { data: [] }

      lowStockItems = (lowProducts || []).map((p: any) => ({
        id: p.id, name: p.name, price: p.price,
        category: Array.isArray(p.category) ? p.category[0]?.name : p.category?.name,
        min_quantity: p.min_quantity || 5,
        current_qty: productQtys[p.id] || 0,
      })).filter((p: any) => p.current_qty <= p.min_quantity).sort((a: any, b: any) => a.current_qty - b.current_qty)

      // All products for request form
      const { data: allProds } = await (admin.from('products') as any)
        .select('id, name, price, min_quantity, category:categories(name)').eq('status', 'active').order('name')
      lowStockAllProducts = allProds || []

      // Product images
      const allIds = [...lowStockItems.map((i: any) => i.id), ...(allProds || []).map((p: any) => p.id)]
      const { data: images } = allIds.length > 0
        ? await (admin.from('product_images') as any).select('product_id, url').in('product_id', allIds).eq('is_primary', true)
        : { data: [] }
      ;(images || []).forEach((img: any) => { if (!lowStockImageMap[img.product_id]) lowStockImageMap[img.product_id] = img.url })
    }
  }

  return (
    <MyRequestsClient
      products={(products || []) as any[]}
      categories={(categories || []) as any[]}
      imageMap={imageMap}
      myRequests={myRequests}
      activeTab={activeTab}
      storeId={storeId}
      lowStockItems={lowStockItems}
      lowStockAllProducts={lowStockAllProducts}
      lowStockImageMap={lowStockImageMap}
    />
  )
}
