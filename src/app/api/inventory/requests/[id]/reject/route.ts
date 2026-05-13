import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()

  const { id } = await params

  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('id, requested_by, status, product:products(name), requested_qty')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Може да откажете само чакащи заявки' }, { status: 400 })
  }

  // Seller can only reject their own requests; admin can reject any
  if (profile?.role !== 'admin' && req.requested_by !== user.id) {
    return NextResponse.json({ error: 'Можете да откажете само ваши заявки' }, { status: 403 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const productName = Array.isArray(req.product) ? req.product[0]?.name : req.product?.name

  await (admin.from('stock_requests') as any)
    .update({ status: 'rejected', updated_at: now })
    .eq('id', id)

  // Log event
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id, status: 'rejected', user_id: user.id,
      notes: `Отказана заявка: ${productName || '—'} (${req.requested_qty} бр.)`,
      created_at: now,
    })
  } catch { /* table may not exist yet */ }

  await logAction({
    action: 'request_reject',
    userId: user.id,
    entityType: 'stock_request',
    entityId: id,
    details: `Отказана заявка: ${productName || '—'} (${req.requested_qty} бр.)`,
  }, admin)

  return NextResponse.json({ success: true, status: 'rejected' })
}
