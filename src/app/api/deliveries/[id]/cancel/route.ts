import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { cancelSchema } from '@/lib/deliveries/schemas'

/**
 * Отказ от доставка (cancel_delivery). A draft is simply cancelled; a received
 * delivery only while nothing of it has left Офис and every received unit is
 * still there. The log keeps both.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Доставката не е намерена' }, { status: 404 })

  const body = await parseBody(request, cancelSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('cancel_delivery', {
    p_delivery_id: id,
    p_user: gate.user.id,
    p_reason: body.data.reason,
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
  return NextResponse.json({ success: true })
}
