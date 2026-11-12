import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { orderCancelSchema } from '@/lib/supplier-orders/schemas'

/** Cancel an order the supplier will not deliver (or sent by mistake), with a reason. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Поръчката не е намерена' }, { status: 404 })

  const body = await parseBody(request, orderCancelSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('cancel_supplier_order', {
    p_order_id: id,
    p_user: gate.user.id,
    p_reason: body.data.reason,
  })
  if (error) return rpcFailure('cancel_supplier_order', error, 'Поръчката не можа да се откаже')

  await logAction({
    action: 'supplier_order_cancelled',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'supplier_order',
    entityId: id,
    details: body.data.reason,
  }, gate.supabase as any)
  return NextResponse.json({ ok: true })
}
