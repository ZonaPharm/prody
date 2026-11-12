import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { shipmentRemoveSchema } from '@/lib/deliveries/schemas'
import { notifyShipmentRemoved } from '@/lib/deliveries/notify'

/** "Махни от курса": one store's shipment leaves a trip that has not left (remove_shipment). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Пратката не е намерена' }, { status: 404 })

  const body = await parseBody(request, shipmentRemoveSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('remove_shipment', { p_shipment_id: id, p_user: gate.user.id, p_reason: body.data.reason })
  if (error) return rpcFailure('remove_shipment', error, 'Пратката не беше махната')
  await notifyShipmentRemoved(admin, id, body.data.reason)

  await logAction({
    action: 'shipment_removed',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'shipment',
    entityId: id,
    details: body.data.reason,
  }, gate.supabase as any)
  return NextResponse.json({ success: true })
}
