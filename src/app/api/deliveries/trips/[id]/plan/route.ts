import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody } from '@/lib/deliveries/api'
import { tripPlanSchema } from '@/lib/deliveries/schemas'
import { applyTripPlan, normalisePlan } from '@/lib/deliveries/trip-plan'
import { notifyTripPlanChanged } from '@/lib/deliveries/notify'
import { whenText } from '@/lib/deliveries/notify-text'
import { sofiaToday } from '@/lib/date-utils'

/**
 * "Шофьор и ден" of a trip that has not left: who drives it and when. A new
 * driver is told, the previous one too, and when the day moves the stores hear it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Курсът не е намерен' }, { status: 404 })

  const body = await parseBody(request, tripPlanSchema)
  if (!body.ok) return body.response
  const plan = normalisePlan(body.data)

  const admin = createAdminClient()
  let result
  try {
    result = await applyTripPlan(admin, id, plan)
  } catch (e) {
    console.error('trip plan failed:', e instanceof Error ? e.message : JSON.stringify(e))
    return NextResponse.json({ error: 'Шофьорът и денят не бяха записани' }, { status: 500 })
  }
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.before ? 400 : 404 })

  if (result.before) await notifyTripPlanChanged(admin, id, result.before)

  await logAction({
    action: 'trip_planned',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'trip',
    entityId: id,
    details: `Шофьор ${plan.driver_id ?? '—'}, ${whenText(plan.planned_date, plan.planned_time, sofiaToday())}`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true })
}
