import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { officeAddSchema } from '@/lib/deliveries/schemas'
import { formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'

/**
 * "Добави от Офис": products Офис already holds (no delivery) go into one store's
 * shipment (add_office_stock). With no trip_id a new trip is made for it. A packed
 * shipment is opened again and must be packed and signed anew.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response

  const body = await parseBody(request, officeAddSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('add_office_stock', {
    p_trip_id: body.data.trip_id ?? null,
    p_store_id: body.data.store_id,
    p_user: gate.user.id,
    p_lines: body.data.lines,
  })
  if (error) return rpcFailure('add_office_stock', error, 'Нищо не беше добавено')

  await logAction({
    action: 'trip_changed',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: data?.trip_id,
    details: `${formatTripNumber(data?.trip_number)}${data?.new_trip ? ' (нов)' : ''}, ${formatShipmentNumber(data?.shipment_number)}: `
      + `от Офис ${data?.units ?? 0} бр.${data?.reopened ? ', пратката е отворена за ново опаковане' : ''}`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data, shipment_ids: data?.shipment_id ? [data.shipment_id] : [] })
}
