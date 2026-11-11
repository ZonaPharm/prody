import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { tripCancelSchema } from '@/lib/deliveries/schemas'

/** Take back a trip that has not left: its ready units wait for the next trip (cancel_trip). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Курсът не е намерен' }, { status: 404 })

  const body = await parseBody(request, tripCancelSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('cancel_trip', { p_trip_id: id, p_user: gate.user.id, p_reason: body.data.reason })
  if (error) return rpcFailure('cancel_trip', error, 'Курсът не беше отказан')

  await logAction({
    action: 'trip_cancelled',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: id,
    details: body.data.reason,
  }, gate.supabase as any)
  return NextResponse.json({ success: true })
}
