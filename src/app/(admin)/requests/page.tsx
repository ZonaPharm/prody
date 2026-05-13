import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RequestsClient } from './requests-client'

export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const [{ data: reqData }, { data: stores }, { data: products }] = await Promise.all([
    (supabase.from('stock_requests') as any)
      .select('id, product_id, store_id, product:products(name), store:stores(name), requested_qty, status, notes, created_at')
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('stores').select('id, name, is_warehouse').eq('is_active', true).order('name'),
    supabase.from('products').select('id, name, price, quantity_on_hand').eq('status', 'active').order('name'),
  ])

  const requests = (reqData || []).map((r: any) => ({
    id: r.id,
    product_id: r.product_id,
    product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
    store_id: r.store_id,
    store_name: Array.isArray(r.store) ? r.store[0]?.name : r.store?.name,
    quantity: r.requested_qty,
    status: r.status,
    notes: r.notes,
    created_at: r.created_at,
  }))

  return (
    <RequestsClient
      requests={requests}
      stores={(stores || []) as any[]}
      allProducts={(products || []) as any[]}
    />
  )
}
