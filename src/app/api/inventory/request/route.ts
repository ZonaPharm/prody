import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requestProblem } from '@/lib/requests/office-stock'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product_id, store_id, quantity, notes } = await request.json()

  const { data: profile } = await (supabase.from('users') as any)
    .select('store_id, role').eq('id', user.id).single()

  const storeId = profile?.store_id || store_id
  if (!storeId) return NextResponse.json({ error: 'No store assigned' }, { status: 400 })

  const qty = Number(quantity || 10)
  if (!product_id || !Number.isInteger(qty) || qty < 1 || qty > 100000) {
    return NextResponse.json({ error: 'Невалидно количество в заявката' }, { status: 400 })
  }
  // Same rule as request-batch: a store asks only for free Офис stock.
  if (profile?.role !== 'admin') {
    let problem: string | null
    try {
      problem = await requestProblem(createAdminClient(), [{ product_id: String(product_id), quantity: qty }])
    } catch (e) {
      console.error('request: office stock check failed:', e instanceof Error ? e.message : JSON.stringify(e))
      return NextResponse.json({ error: 'Не успяхме да проверим наличността в Офис. Опитайте пак.' }, { status: 503 })
    }
    if (problem) return NextResponse.json({ error: problem }, { status: 409 })
  }

  const { data, error } = await (supabase.from('stock_requests') as any)
    .insert({
      product_id,
      store_id: storeId,
      requested_by: user.id,
      requested_qty: qty,
      notes: notes || null,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log event (if table exists)
  try {
    const admin = createAdminClient()
    await (admin.from('request_events') as any).insert({
      request_id: data.id,
      status: 'pending',
      user_id: user.id,
      notes: notes || 'Заявката е създадена',
      created_at: new Date().toISOString(),
    })
  } catch { /* table doesn't exist yet */ }

  return NextResponse.json({ success: true, id: data.id })
}
