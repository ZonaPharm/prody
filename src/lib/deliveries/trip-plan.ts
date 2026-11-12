/**
 * "Шофьор и ден" of a trip: who is to drive it and when it is to leave, set when
 * the trip is made and changeable until it leaves. Written with the service-role
 * client by the trip routes; send_trip later records who actually signed
 * (trips.driver_id), which may be someone else.
 */

type Admin = any

export type TripPlan = {
  driver_id: string | null
  planned_date: string | null
  planned_time: string | null
}

export type TripPlanBefore = { status: string; planned_driver_id: string | null; planned_date: string | null; planned_time: string | null }

/** The plan as stored: the hour is kept only with a day. */
export function normalisePlan(plan: Partial<TripPlan>): TripPlan {
  const planned_date = plan.planned_date || null
  return {
    driver_id: plan.driver_id || null,
    planned_date,
    planned_time: planned_date ? plan.planned_time || null : null,
  }
}

/** True when there is anything to store. */
export function hasPlan(plan: TripPlan): boolean {
  return !!(plan.driver_id || plan.planned_date)
}

/** Postgres gives "09:30:00"; the form and the comparison use "09:30". */
export function hhmm(time: string | null | undefined): string | null {
  return time ? time.slice(0, 5) : null
}

/**
 * Stores the plan on an open trip. Returns an error in Bulgarian, or null.
 * The driver must be an active account (anyone may drive; see src/lib/roles.ts).
 */
export async function applyTripPlan(admin: Admin, tripId: string, plan: TripPlan): Promise<{ error: string | null; before: TripPlanBefore | null }> {
  const { data: trip, error: e1 } = await admin
    .from('trips')
    .select('status, planned_driver_id, planned_date, planned_time')
    .eq('id', tripId)
    .maybeSingle()
  if (e1) throw e1
  if (!trip) return { error: 'Курсът не е намерен', before: null }
  const before: TripPlanBefore = { ...trip, planned_time: hhmm(trip.planned_time) }
  if (trip.status !== 'open') return { error: 'Курсът вече е тръгнал или е отказан', before }

  if (plan.driver_id) {
    const { data: driver, error: e2 } = await admin.from('users').select('*').eq('id', plan.driver_id).maybeSingle()
    if (e2) throw e2
    if (!driver || driver.is_active === false) return { error: 'Шофьорът не е намерен или акаунтът му е спрян', before }
  }

  const { error: e3 } = await admin
    .from('trips')
    .update({ planned_driver_id: plan.driver_id, planned_date: plan.planned_date, planned_time: plan.planned_time })
    .eq('id', tripId)
    .eq('status', 'open')
  if (e3) throw e3
  return { error: null, before }
}
