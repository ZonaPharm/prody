import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { items, store_id, notes } = body

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Няма продукти в заявката' }, { status: 400 })
  }

  const { data: profile } = await (supabase.from('users') as any)
    .select('store_id').eq('id', user.id).single()

  const storeId = profile?.store_id || store_id
  if (!storeId) return NextResponse.json({ error: 'No store assigned' }, { status: 400 })

  // Use a shared created_at for grouping (exact same timestamp = same batch)
  const now = new Date().toISOString()

  const results: string[] = []
  for (const item of items) {
    const { data, error } = await (supabase.from('stock_requests') as any)
      .insert({
        product_id: item.product_id,
        store_id: storeId,
        requested_by: user.id,
        requested_qty: item.quantity || 1,
        notes: notes || null,
        created_at: now,
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Log event
    try {
      const admin = createAdminClient()
      await (admin.from('request_events') as any).insert({
        request_id: data.id,
        status: 'pending',
        user_id: user.id,
        notes: notes || 'Заявката е създадена',
        created_at: now,
      })
    } catch { /* table doesn't exist yet */ }

    results.push(data.id)
  }

  await logAction({ action: 'request_create', userId: user.id, entityType: 'stock_request', details: `${items.length} продукта` }, supabase)
  return NextResponse.json({ success: true, ids: results, count: results.length })
}
