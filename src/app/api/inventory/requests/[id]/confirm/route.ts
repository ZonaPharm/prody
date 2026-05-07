import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { received_qty, notes } = body

  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('store_id, status, requested_qty')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'fulfilled') {
    return NextResponse.json({ error: 'Заявката не е изпълнена все още' }, { status: 400 })
  }

  const admin = createAdminClient()
  const status = received_qty != null && received_qty < req.requested_qty ? 'partial' : 'confirmed'
  const eventNotes = notes || (status === 'partial'
    ? `Получени ${received_qty} от ${req.requested_qty} бр.`
    : `Потвърдено получаване на ${req.requested_qty} бр.`)

  await (admin.from('stock_requests') as any)
    .update({
      status,
      received_qty: received_qty ?? req.requested_qty,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  // Log event (if table exists)
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id,
      status,
      user_id: user.id,
      notes: eventNotes,
      meta: { received_qty: received_qty ?? req.requested_qty, requested_qty: req.requested_qty },
      created_at: new Date().toISOString(),
    })
  } catch { /* table doesn't exist yet */ }

  return NextResponse.json({ success: true, status })
}
