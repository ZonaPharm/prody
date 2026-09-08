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
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('id, status, requested_qty').eq('id', id).single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'accepted') {
    return NextResponse.json({ error: 'Може да изпратите само приети заявки' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // How much actually moved. Callers that send nothing are treated as shipping
  // the full amount, which is what every existing caller meant.
  const shippedQty = Number.isFinite(Number(body?.shipped_qty))
    ? Math.max(0, Math.floor(Number(body.shipped_qty)))
    : req.requested_qty

  // A short shipment is still a shipment: those units are on their way and the
  // shop has to receive them like any other. The shortfall lives in
  // shipped_qty, not in the status — marking it 'partial' here would take the
  // request out of the in-transit flow and leave nobody to confirm arrival.
  const isPartial = shippedQty < req.requested_qty
  const nothingSent = shippedQty === 0
  const status = 'in_transit'

  const updatePayload: Record<string, any> = {
    status,
    shipped_qty: shippedQty,
    in_transit_at: now,
    updated_at: now,
  }

  const { error: updErr } = await (admin.from('stock_requests') as any)
    .update(updatePayload)
    .eq('id', id)

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  try {
    await (admin.from('request_events') as any).insert({
      request_id: id, status, user_id: user.id,
      notes: nothingSent
        ? `Няма наличност — 0 от ${req.requested_qty} бр.`
        : isPartial
          ? `Изпратени ${shippedQty} от ${req.requested_qty} бр.`
          : 'Пратена към магазина',
      created_at: now,
    })
  } catch { /* table may not exist */ }

  try {
    await (admin.from('request_notes') as any).insert({
      request_id: id, user_id: user.id,
      body: nothingSent
        ? `⚠️ Няма наличност — 0 от ${req.requested_qty} бр. не са изпратени`
        : isPartial
          ? `📦 Изпратени ${shippedQty} от ${req.requested_qty} бр. — частично`
          : '📦 Заявката е изпратена към магазина',
    })
  } catch {}
  await logAction({
    action: 'request_ship',
    userId: user.id,
    entityType: 'stock_request',
    entityId: id,
    details: `${shippedQty} от ${req.requested_qty} бр.`,
  }, admin)
  return NextResponse.json({ success: true, status, shipped_qty: shippedQty })
}
