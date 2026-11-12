import { deliveriesEnabledFor } from './feature'
import { canWorkDeliveries } from '@/lib/roles'
import {
  shipmentComingText,
  shipmentIssueText,
  shipmentRemovedText,
  shipmentSentText,
  tripAssignedText,
  tripCancelledText,
  tripMovedText,
  tripUnassignedText,
  type NotificationText,
  type TripInfo,
} from './notify-text'
import { sofiaToday } from '@/lib/date-utils'

/**
 * Notifications along the Deliveries chain: written by the API routes with the
 * service-role client right after the change they tell about. They are best
 * effort: a failure here is logged and never undoes or fails the change itself
 * (the trip is made even if a message could not be written).
 *
 * Who reads them: the "Задачи" screen of each person (/tasks for admins,
 * /my-tasks for sellers) and the count beside it in the menu.
 */

type Admin = any

type Row = NotificationText & {
  user_id: string
  link: string | null
  trip_id?: string | null
  shipment_id?: string | null
}

type Recipient = { id: string; role: string }

/** Where a notification opens: the person's own "Задачи", by role. */
export function tasksHref(role: string): string {
  return role === 'admin' ? '/tasks' : '/my-tasks'
}

async function insert(admin: Admin, rows: Row[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await admin.from('notifications').insert(rows)
  if (error) throw error
}

/** Runs one notification step; logs and swallows any failure. */
async function safely(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    console.error(`notify ${what} failed:`, e instanceof Error ? e.message : JSON.stringify(e))
  }
}

async function usersByIds(admin: Admin, ids: (string | null | undefined)[]): Promise<Recipient[]> {
  const want = [...new Set(ids.filter(Boolean) as string[])]
  if (want.length === 0) return []
  const { data, error } = await admin.from('users').select('id, role, is_active').in('id', want)
  if (error) throw error
  return (data ?? []).filter((u: any) => u.is_active !== false).map((u: any) => ({ id: u.id, role: u.role }))
}

/** Active accounts that sell in these stores. A trip has a handful of stores, so .in() stays short. */
async function storeUsers(admin: Admin, storeIds: string[]): Promise<(Recipient & { store_id: string })[]> {
  const want = [...new Set(storeIds.filter(Boolean))]
  if (want.length === 0) return []
  const { data, error } = await admin.from('users').select('id, role, is_active, store_id').in('store_id', want)
  if (error) throw error
  return (data ?? [])
    .filter((u: any) => u.is_active !== false)
    .map((u: any) => ({ id: u.id, role: u.role, store_id: u.store_id }))
}

/**
 * Active people who work with deliveries: Администратор and Офис (src/lib/roles.ts),
 * with the feature switch on for them. Офис opens its tasks in the admin area,
 * so its links go there too (role 'admin' here only picks the link).
 */
async function deliveryAdmins(admin: Admin): Promise<Recipient[]> {
  // '*': before migration 20261112_user_roles there is no roles column.
  const { data, error } = await admin.from('users').select('*').limit(1000)
  if (error) throw error
  return (data ?? [])
    .filter((u: any) => u.is_active !== false && canWorkDeliveries(u) && deliveriesEnabledFor(u.email))
    .map((u: any) => ({ id: u.id, role: 'admin' as const }))
}

type TripRead = TripInfo & {
  id: string
  status: string
  planned_driver_id: string | null
  shipments: { id: string; number: number; store_id: string; store: string; status: string; units: number; products: number; boxes: number | null }[]
}

/** The trip as the messages need it: its stores in name order, units per shipment. */
export async function readTrip(admin: Admin, tripId: string): Promise<TripRead | null> {
  const { data: t, error } = await admin
    .from('trips')
    .select(
      'id, number, status, planned_driver_id, planned_date, planned_time, ' +
        'shipments:shipments!shipments_trip_id_fkey(id, number, store_id, status, box_count, ' +
        'store:stores!shipments_store_id_fkey(name), lines:shipment_lines!shipment_lines_shipment_id_fkey(qty, product_id))',
    )
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw error
  if (!t) return null
  const shipments = (t.shipments ?? [])
    .map((s: any) => ({
      id: s.id,
      number: s.number,
      store_id: s.store_id,
      store: s.store?.name ?? '?',
      status: s.status,
      boxes: s.box_count ?? null,
      units: (s.lines ?? []).reduce((n: number, l: any) => n + l.qty, 0),
      products: new Set((s.lines ?? []).map((l: any) => l.product_id)).size,
    }))
    .sort((a: any, b: any) => a.store.localeCompare(b.store, 'bg'))
  const live = shipments.filter((s: any) => s.status !== 'cancelled')
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    planned_driver_id: t.planned_driver_id ?? null,
    planned_date: t.planned_date ?? null,
    planned_time: t.planned_time ? String(t.planned_time).slice(0, 5) : null,
    stores: live.map((s: any) => s.store),
    shipments,
  }
}

/** Sellers of each store on the trip (or of the given shipments only) get `text(shipment)`. */
async function toStores(
  admin: Admin,
  trip: TripRead,
  shipmentIds: string[] | null,
  text: (s: TripRead['shipments'][number]) => NotificationText,
  link: (s: TripRead['shipments'][number], role: string) => string,
) {
  const ships = trip.shipments.filter(s => (shipmentIds ? shipmentIds.includes(s.id) : s.status !== 'cancelled'))
  const users = await storeUsers(admin, ships.map(s => s.store_id))
  const rows: Row[] = []
  for (const s of ships) {
    const t = text(s)
    for (const u of users.filter(x => x.store_id === s.store_id)) {
      rows.push({ ...t, user_id: u.id, link: link(s, u.role), trip_id: trip.id, shipment_id: s.id })
    }
  }
  await insert(admin, rows)
}

/** A trip was made (or got new shipments): its driver and the stores it goes to. */
export async function notifyTripCreated(admin: Admin, tripId: string, opts: { shipmentIds?: string[] } = {}) {
  await safely('trip created', async () => {
    const trip = await readTrip(admin, tripId)
    if (!trip) return
    const today = sofiaToday()
    if (!opts.shipmentIds) {
      const [driver] = await usersByIds(admin, [trip.planned_driver_id])
      if (driver) {
        await insert(admin, [{ ...tripAssignedText(trip, today), user_id: driver.id, link: tasksHref(driver.role), trip_id: trip.id }])
      }
    }
    await toStores(admin, trip, opts.shipmentIds ?? null,
      s => shipmentComingText(s, trip, today),
      (_s, role) => tasksHref(role))
  })
}

/** The driver, day or hour of a trip changed before it left. */
export async function notifyTripPlanChanged(
  admin: Admin,
  tripId: string,
  before: { planned_driver_id: string | null; planned_date: string | null; planned_time: string | null },
) {
  await safely('trip plan changed', async () => {
    const trip = await readTrip(admin, tripId)
    if (!trip) return
    const today = sofiaToday()
    const driverChanged = before.planned_driver_id !== trip.planned_driver_id
    const moved = before.planned_date !== trip.planned_date || (before.planned_time ?? null) !== (trip.planned_time ?? null)
    const people = await usersByIds(admin, [before.planned_driver_id, trip.planned_driver_id])
    const rows: Row[] = []
    const oldDriver = people.find(p => p.id === before.planned_driver_id)
    const newDriver = people.find(p => p.id === trip.planned_driver_id)
    if (driverChanged && oldDriver) rows.push({ ...tripUnassignedText(trip), user_id: oldDriver.id, link: tasksHref(oldDriver.role), trip_id: trip.id })
    if (driverChanged && newDriver) rows.push({ ...tripAssignedText(trip, today), user_id: newDriver.id, link: tasksHref(newDriver.role), trip_id: trip.id })
    if (!driverChanged && moved && newDriver) rows.push({ ...tripMovedText(trip, today), user_id: newDriver.id, link: tasksHref(newDriver.role), trip_id: trip.id })
    await insert(admin, rows)
    if (moved) {
      await toStores(admin, trip, null,
        () => tripMovedText(trip, today),
        (_s, role) => tasksHref(role))
    }
  })
}

/** The driver signed and the trip left Офис: each store hears its shipment is on the way. */
export async function notifyTripSent(admin: Admin, tripId: string, driverName: string | null) {
  await safely('trip sent', async () => {
    const trip = await readTrip(admin, tripId)
    if (!trip) return
    await toStores(admin, trip, trip.shipments.filter(s => s.status === 'sent').map(s => s.id),
      s => shipmentSentText(s, driverName),
      (s, role) => (role === 'admin' ? tasksHref(role) : `/my-shipments/${s.id}`))
  })
}

/** One store was taken off a trip before it left. */
export async function notifyShipmentRemoved(admin: Admin, shipmentId: string, reason: string | null) {
  await safely('shipment removed', async () => {
    const { data: s, error } = await admin.from('shipments').select('trip_id').eq('id', shipmentId).maybeSingle()
    if (error) throw error
    if (!s) return
    const trip = await readTrip(admin, s.trip_id)
    if (!trip) return
    await toStores(admin, trip, [shipmentId],
      ship => shipmentRemovedText(ship, trip.number, reason),
      (_s, role) => tasksHref(role))
  })
}

/**
 * The trip was taken back. Read its stores BEFORE cancelling (cancel_trip may
 * empty the shipments), then call this with what was read.
 */
export async function notifyTripCancelled(admin: Admin, trip: TripRead | null, reason: string | null) {
  if (!trip) return
  await safely('trip cancelled', async () => {
    const text = tripCancelledText(trip, reason)
    const [driver] = await usersByIds(admin, [trip.planned_driver_id])
    const rows: Row[] = []
    if (driver) rows.push({ ...text, user_id: driver.id, link: tasksHref(driver.role), trip_id: trip.id })
    const users = await storeUsers(admin, trip.shipments.filter(s => s.status !== 'cancelled').map(s => s.store_id))
    for (const u of users) {
      if (u.id === driver?.id) continue
      const ship = trip.shipments.find(s => s.store_id === u.store_id)
      rows.push({ ...text, user_id: u.id, link: tasksHref(u.role), trip_id: trip.id, shipment_id: ship?.id ?? null })
    }
    await insert(admin, rows)
  })
}

/** A store accepted a shipment with differences: the admins who handle problems. */
export async function notifyShipmentIssue(admin: Admin, shipmentId: string, signals: number) {
  if (!signals) return
  await safely('shipment issue', async () => {
    const { data: s, error } = await admin
      .from('shipments')
      .select('id, number, trip_id, store:stores!shipments_store_id_fkey(name)')
      .eq('id', shipmentId)
      .maybeSingle()
    if (error) throw error
    if (!s) return
    const admins = await deliveryAdmins(admin)
    const text = shipmentIssueText(s, s.store?.name ?? 'Магазин', signals)
    await insert(admin, admins.map(a => ({ ...text, user_id: a.id, link: '/deliveries/problems', trip_id: s.trip_id, shipment_id: s.id })))
  })
}
