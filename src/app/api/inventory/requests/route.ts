import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = (supabase.from('stock_requests') as any)
    .select('id, product:products(name), store:stores(name), requested_qty, status, notes, created_at')
  if (status) query = query.eq('status', status)
  const { data } = await query.order('created_at', { ascending: false }).limit(100)

  const requests = (data || []).map((r: any) => ({
    id: r.id,
    product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
    store_name: Array.isArray(r.store) ? r.store[0]?.name : r.store?.name,
    quantity: r.requested_qty,
    status: r.status,
    notes: r.notes,
    created_at: r.created_at,
  }))

  return NextResponse.json(requests)
}
