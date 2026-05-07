import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RequestsClient } from './requests-client'

export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const { data } = await (supabase.from('stock_requests') as any)
    .select('id, product:products(name), store:stores(name), requested_qty, status, notes, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  const requests = (data || []).map((r: any) => ({
    id: r.id,
    product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
    product_id: r.product_id,
    store_name: Array.isArray(r.store) ? r.store[0]?.name : r.store?.name,
    store_id: r.store_id,
    quantity: r.requested_qty,
    status: r.status,
    notes: r.notes,
    created_at: r.created_at,
  }))

  return <RequestsClient requests={requests} />
}
