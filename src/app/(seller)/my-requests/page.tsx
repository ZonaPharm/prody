import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MyRequestsClient } from './client'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { getStoreIncomingAll } from '@/lib/deliveries/tasks-data'
import { incomingByProduct, incomingText } from '@/lib/deliveries/tasks'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { getOfficeStock, notRequestable, notRequestableReason, type OfficeStockMap } from '@/lib/requests/office-stock'

export const dynamic = 'force-dynamic'

export default async function MyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; product?: string }>
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

  // Each read is a round trip to the database. The reads that do not need the
  // catalog or Офис stock start now, so they run alongside the reads below
  // instead of after them: the "Мои заявки" list and what already comes to this
  // store from Офис (on the way, on a trip, being prepared), so nobody asks for
  // it again. That one is read with the service-role client, only for this
  // store; a failure just leaves the hints out.
  const myRequestsRead = activeTab === 'my'
    ? (admin.from('stock_requests') as any)
      .select('id, product:products(name), requested_qty, status, notes, created_at, accepted_at, in_transit_at, delivered_at')
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
      // A query builder sends nothing until it is awaited; then() sends it now.
      .then((r: { data: any[] | null }) => r)
    : Promise.resolve({ data: [] as any[] })
  const incomingRead: Promise<Record<string, string>> = storeId && deliveriesActive() && activeTab !== 'my'
    ? getStoreIncomingAll(admin, storeId).then(({ ships, planned }) => {
        const out: Record<string, string> = {}
        for (const [productId, x] of Object.entries(incomingByProduct(ships, planned))) {
          const text = incomingText(x)
          if (text) out[productId] = text
        }
        return out
      }).catch((e: unknown) => {
        console.error('requests: incoming failed:', e instanceof Error ? e.message : JSON.stringify(e))
        return {}
      })
    : Promise.resolve({})

  // Products for request form (with images + categories for grid view). A store
  // may ask only for what Офис can send now (free Офис stock): the rest of the
  // catalog is not offered, only named with the reason when searched for.
  const [catalog, { data: categories }, images, office] = await Promise.all([
    fetchAll<any>(() => (admin.from('products') as any).select('id, name, price, category_id').eq('status', 'active').order('name').order('id')),
    (admin.from('categories') as any).select('id, name').order('name'),
    // All primary pictures, page by page: past 1000 rows PostgREST would cut the list.
    fetchAll<any>(() => (admin.from('product_images') as any).select('product_id, url').eq('is_primary', true).order('id'))
      .catch((e: unknown) => { console.error('requests: images failed:', e); return [] as any[] }),
    getOfficeStock(admin).catch((e: unknown) => {
      console.error('requests: office stock failed:', e instanceof Error ? e.message : JSON.stringify(e))
      return null as OfficeStockMap | null
    }),
  ])
  const officeStock: OfficeStockMap = office ?? {}
  const products = catalog
    .filter((p: any) => (officeStock[p.id]?.free ?? 0) > 0)
    .map((p: any) => ({ ...p, office_qty: officeStock[p.id].free }))
  const unavailable = catalog
    .filter((p: any) => !((officeStock[p.id]?.free ?? 0) > 0))
    .map((p: any) => ({ id: p.id, name: p.name, why: notRequestable(officeStock[p.id]) ?? 'none' }))

  const imageMap: Record<string, string> = {}
  ;(images || []).forEach((img: any) => { if (!imageMap[img.product_id]) imageMap[img.product_id] = img.url })

  // My requests
  let myRequests: any[] = []
  if (activeTab === 'my') {
    const { data } = await myRequestsRead
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
  let lowStockImageMap: Record<string, string> = {}
  if (activeTab === 'low') {
    if (storeId) {
      const batches = await fetchAll<any>(() => (admin.from('stock_batches') as any)
        .select('id, product_id, quantity_remaining').eq('store_id', storeId).order('id'))
      const productQtys: Record<string, number> = {}
      ;(batches || []).forEach((b: any) => { productQtys[b.product_id] = (productQtys[b.product_id] || 0) + b.quantity_remaining })

      const productIds = Object.keys(productQtys)
      const lowProducts = (await fetchByIds<any>(
        ids => (admin.from('products') as any).select('id, name, price, min_quantity, category:categories(name)').in('id', ids),
        productIds,
      )).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'bg'))

      lowStockItems = (lowProducts || []).map((p: any) => ({
        id: p.id, name: p.name, price: p.price,
        category: Array.isArray(p.category) ? p.category[0]?.name : p.category?.name,
        min_quantity: p.min_quantity || 5,
        current_qty: productQtys[p.id] || 0,
        office_qty: officeStock[p.id]?.free ?? 0,
        office_reason: notRequestableReason(officeStock[p.id]),
      })).filter((p: any) => p.current_qty <= p.min_quantity).sort((a: any, b: any) => a.current_qty - b.current_qty)

      // Pictures of the low-stock rows only (a short list: .in() stays short).
      const lowIds = lowStockItems.map((i: any) => i.id).slice(0, 300)
      const { data: images } = lowIds.length > 0
        ? await (admin.from('product_images') as any).select('product_id, url').in('product_id', lowIds).eq('is_primary', true)
        : { data: [] }
      ;(images || []).forEach((img: any) => { if (!lowStockImageMap[img.product_id]) lowStockImageMap[img.product_id] = img.url })
    }
  }

  const incoming = await incomingRead

  return (
    <MyRequestsClient
      incoming={incoming}
      products={products}
      unavailable={unavailable}
      officeFailed={office === null}
      categories={(categories || []) as any[]}
      imageMap={imageMap}
      myRequests={myRequests}
      activeTab={activeTab}
      storeId={storeId}
      lowStockItems={lowStockItems}
      lowStockImageMap={lowStockImageMap}
      initialProductId={sp.product}
    />
  )
}
