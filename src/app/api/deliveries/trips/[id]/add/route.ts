import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { tripAddSchema } from '@/lib/deliveries/schemas'
import { formatTripNumber } from '@/lib/deliveries/format'
import { notifyTripCreated } from '@/lib/deliveries/notify'

/**
 * "Добави в курса": what became ready after the trip was made goes into it (add_to_trip):
 * new lines or more units on a shipment still being packed, a new shipment for a new store.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Курсът не е намерен' }, { status: 404 })

  const body = await parseBody(request, tripAddSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('add_to_trip', {
    p_trip_id: id,
    p_user: gate.user.id,
    p_store_ids: [...new Set(body.data.store_ids)],
  })
  if (error) return rpcFailure('add_to_trip', error, 'Нищо не беше добавено')
  // The stores that got more (or a new shipment) hear what now comes to them.
  const added = ((data?.shipments ?? []) as { shipment_id?: string }[]).map(s => s.shipment_id).filter(Boolean) as string[]
  if (added.length) await notifyTripCreated(admin, id, { shipmentIds: added })

  await logAction({
    action: 'trip_changed',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: id,
    details: `${formatTripNumber(data?.number)}: добавени ${data?.units ?? 0} бр.`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data })
}
