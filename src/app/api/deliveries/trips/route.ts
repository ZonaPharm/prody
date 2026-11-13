import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { tripCreateSchema } from '@/lib/deliveries/schemas'
import { formatTripNumber } from '@/lib/deliveries/format'
import { applyTripPlan, hasPlan, normalisePlan } from '@/lib/deliveries/trip-plan'
import { notifyTripCreated } from '@/lib/deliveries/notify'

/**
 * "Нов курс": one shipment per ticked store with everything ready for it now,
 * from every open delivery (create_trip). Stores with nothing ready are skipped.
 * With a driver and a day ("Шофьор и ден") the trip is planned at once; then the
 * driver and the sellers of each store get a notification.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response

  const body = await parseBody(request, tripCreateSchema)
  if (!body.ok) return body.response

  const plan = normalisePlan(body.data)
  const admin = createAdminClient()
  if (plan.driver_id) {
    const { data: driver } = await (admin.from('users') as any).select('id, is_active').eq('id', plan.driver_id).maybeSingle()
    if (!driver || driver.is_active === false) {
      return NextResponse.json({ error: 'Шофьорът не е намерен или акаунтът му е спрян' }, { status: 400 })
    }
  }
  const { data, error } = await (admin as any).rpc('create_trip', {
    p_user: gate.user.id,
    p_store_ids: [...new Set(body.data.store_ids)],
    p_notes: body.data.notes || null,
  })
  if (error) return rpcFailure('create_trip', error, 'Курсът не беше създаден')

  // The trip exists now; a failed plan only leaves it without driver and day
  // (they can be set on the trip page), so it is reported, not undone.
  let planError: string | null = null
  if (data?.trip_id && hasPlan(plan)) {
    try {
      planError = (await applyTripPlan(admin, data.trip_id, plan)).error
    } catch (e) {
      console.error('trip plan failed:', e instanceof Error ? e.message : JSON.stringify(e))
      planError = 'Шофьорът и денят не бяха записани. Задайте ги в курса.'
    }
  }
  if (data?.trip_id) await notifyTripCreated(admin, data.trip_id)

  await logAction({
    action: 'trip_created',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: data?.trip_id,
    details: `${formatTripNumber(data?.number)}: ${(data?.shipments ?? []).length} пратки`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data, ...(planError ? { warning: planError } : {}) })
}
