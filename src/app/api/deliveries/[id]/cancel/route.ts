import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { cancelSchema } from '@/lib/deliveries/schemas'

/**
 * Отказ от доставка (cancel_delivery). A draft is simply cancelled; a received
 * delivery takes its units back from Офис and from every store it reached
 * (20261117_cancel_delivery_from_stores). When a store has already sold part,
 * the call is refused unless the person accepted that shortfall (accept_short).
 * The log keeps everything.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Доставката не е намерена' }, { status: 404 })

  const body = await parseBody(request, cancelSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  // p_accept_short only when given, so the call also works on a database before the migration.
  const { data, error } = await (admin as any).rpc('cancel_delivery', {
    p_delivery_id: id,
    p_user: gate.user.id,
    p_reason: body.data.reason,
    ...(body.data.accept_short ? { p_accept_short: true } : {}),
  })
  if (error) return rpcFailure('cancel_delivery', error, 'Доставката не можа да се откаже')

  await logAction({
    action: 'delivery_cancelled',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'delivery',
    entityId: id,
    details: body.data.reason,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, result: data ?? null })
}

/**
 * What a cancel would take back, per store and product (cancel_delivery_preview),
 * for the dialog. preview is null on a database before the migration.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Доставката не е намерена' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('cancel_delivery_preview', { p_delivery_id: id })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return NextResponse.json({ preview: null })
    return rpcFailure('cancel_delivery_preview', error, 'Не можах да проверя къде е стоката')
  }
  return NextResponse.json({ preview: data ?? [] })
}
