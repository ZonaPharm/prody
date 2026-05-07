import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product_id, store_id, quantity, notes } = await request.json()

  const { data: profile } = await (supabase.from('users') as any)
    .select('store_id').eq('id', user.id).single()

  const storeId = profile?.store_id || store_id
  if (!storeId) return NextResponse.json({ error: 'No store assigned' }, { status: 400 })

  const { data, error } = await (supabase.from('stock_requests') as any)
    .insert({
      product_id,
      store_id: storeId,
      requested_by: user.id,
      requested_qty: quantity || 10,
      notes: notes || null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id })
}
