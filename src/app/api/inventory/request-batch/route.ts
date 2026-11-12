import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { requestProblem } from '@/lib/requests/office-stock'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { items, store_id, notes } = body

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Няма продукти в заявката' }, { status: 400 })
  }

  const clean = items.map((i: any) => ({ product_id: String(i?.product_id ?? ''), quantity: Number(i?.quantity ?? 1) }))
  if (clean.some((i: any) => !i.product_id || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 100000)) {
    return NextResponse.json({ error: 'Невалидно количество в заявката' }, { status: 400 })
  }

  const { data: profile } = await (supabase.from('users') as any)
    .select('store_id, role').eq('id', user.id).single()

  const storeId = profile?.store_id || store_id
  if (!storeId) return NextResponse.json({ error: 'No store assigned' }, { status: 400 })

  // A store may ask only for what Офис can send now (free Офис stock). Admins
  // may still write a request for anything on a store's behalf.
  if (profile?.role !== 'admin') {
    let problem: string | null
    try {
      problem = await requestProblem(createAdminClient(), clean)
    } catch (e) {
      console.error('request-batch: office stock check failed:', e instanceof Error ? e.message : JSON.stringify(e))
      return NextResponse.json({ error: 'Не успяхме да проверим наличността в Офис. Опитайте пак.' }, { status: 503 })
    }
    if (problem) return NextResponse.json({ error: problem }, { status: 409 })
  }

  // Use a shared created_at for grouping (exact same timestamp = same batch)
  const now = new Date().toISOString()

  const results: string[] = []
  for (const item of clean) {
    const { data, error } = await (supabase.from('stock_requests') as any)
      .insert({
        product_id: item.product_id,
        store_id: storeId,
        requested_by: user.id,
        requested_qty: item.quantity,
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
