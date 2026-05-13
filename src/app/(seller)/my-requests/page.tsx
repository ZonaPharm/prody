import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SellerRequestsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function SellerRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const user = await requireAuth()
  await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()
  const sp = await searchParams
  const activeTab = sp.tab || 'request'

  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, price, quantity_on_hand')
    .eq('status', 'active')
    .order('name')

  let myRequests: any[] = []
  if (activeTab === 'my') {
    const { data } = await (supabase.from('stock_requests') as any)
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

  return (
    <SellerRequestsClient
      products={(products || []) as any[]}
      myRequests={myRequests}
      activeTab={activeTab}
    />
  )
}
