import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { tripCreateSchema } from '@/lib/deliveries/schemas'
import { formatTripNumber } from '@/lib/deliveries/format'

/**
 * "Нов курс": one shipment per ticked store with everything ready for it now,
 * from every open delivery (create_trip). Stores with nothing ready are skipped.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response

  const body = await parseBody(request, tripCreateSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('create_trip', {
    p_user: gate.user.id,
    p_store_ids: [...new Set(body.data.store_ids)],
    p_notes: body.data.notes || null,
  })
  if (error) return rpcFailure('create_trip', error, 'Курсът не беше създаден')

  await logAction({
    action: 'trip_created',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: data?.trip_id,
    details: `${formatTripNumber(data?.number)}: ${(data?.shipments ?? []).length} пратки`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data })
}
