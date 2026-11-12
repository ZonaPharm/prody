import { fetchAll } from '@/lib/fetch-all'
import { sofiaToday } from '@/lib/date-utils'
import { getStoreOptions } from './queries'
import { readyByStore, labelItems } from './queue'
import {
  countOpenProblems,
  getLabelItems,
  getOpenPlanRows,
  getTrips,
  getUnsentLines,
  getWaitingAtStores,
  getWaitingToReceive,
} from './work'
import {
  actionCount,
  adminTasks,
  driverPoolTasks,
  driverTasks,
  sortTasks,
  storeTasks,
  type AdminTrip,
  type DriverTrip,
  type StorePlanned,
  type StoreShipment,
  type Task,
} from './tasks'

/**
 * Reads behind "Задачи" and the count beside it in the menu.
 *
 * Sellers may not read trips or plans (RLS), so the driver's trips and the
 * store's incoming goods are read with the service-role client, always filtered
 * to this person's own id or own store, on the server only. The Офис cards use
 * the admin's own session, like "За работа".
 */

type Db = any

const OPEN_DELIVERY = ['expected', 'in_progress']

function hhmm(t: string | null | undefined): string | null {
  return t ? String(t).slice(0, 5) : null
}

/** Trips this person is to drive (open) or drives now (departed). */
export async function getDriverTrips(db: Db, userId: string): Promise<DriverTrip[]> {
  const { data, error } = await db
    .from('trips')
    .select(
      'id, number, status, planned_date, planned_time, departed_at, notes, planned_driver_id, driver_id, ' +
        'shipments:shipments!shipments_trip_id_fkey(id, status, box_count, store:stores!shipments_store_id_fkey(name), ' +
        'lines:shipment_lines!shipment_lines_shipment_id_fkey(qty))',
    )
    .in('status', ['open', 'departed'])
    .or(`planned_driver_id.eq.${userId},driver_id.eq.${userId}`)
    .order('number')
    .limit(100)
  if (error) throw error
  return (data ?? [])
    // An open trip belongs to its planned driver; once it left, to who signed.
    .filter((t: any) => (t.status === 'open' ? t.planned_driver_id === userId : t.driver_id === userId))
    .map((t: any) => ({
      id: t.id,
      number: t.number,
      status: t.status,
      planned_date: t.planned_date ?? null,
      planned_time: hhmm(t.planned_time),
      departed_at: t.departed_at,
      notes: t.notes,
      shipments: (t.shipments ?? [])
        .map((s: any) => ({
          store: s.store?.name ?? '?',
          status: s.status,
          boxes: s.box_count ?? null,
          units: (s.lines ?? []).reduce((n: number, l: any) => n + l.qty, 0),
        }))
        .sort((a: any, b: any) => a.store.localeCompare(b.store, 'bg')),
    }))
}

/** Shipments to this store that are on a trip or on the way (not yet accepted). */
export async function getStoreIncoming(db: Db, storeId: string): Promise<StoreShipment[]> {
  const rows = await fetchAll<any>(() =>
    db
      .from('shipments')
      .select(
        'id, number, status, box_count, ' +
          'trip:trips!shipments_trip_id_fkey!inner(number, status, planned_date, planned_time, ' +
          'planned_driver:users!trips_planned_driver_id_fkey(display_name), driver:users!trips_driver_id_fkey(display_name)), ' +
          'lines:shipment_lines!shipment_lines_shipment_id_fkey(qty, plan_id, product_id, product:products!shipment_lines_product_id_fkey(name))',
      )
      .eq('store_id', storeId)
      .in('status', ['packing', 'packed', 'sent'])
      .in('trip.status', ['open', 'departed'])
      .order('number'),
  )
  return rows
    .filter(s => s.trip && s.trip.status !== 'cancelled')
    .map(s => ({
      id: s.id,
      number: s.number,
      status: s.status,
      boxes: s.box_count ?? null,
      trip_number: s.trip?.number ?? null,
      planned_date: s.trip?.planned_date ?? null,
      planned_time: hhmm(s.trip?.planned_time),
      driver: s.trip?.driver?.display_name ?? s.trip?.planned_driver?.display_name ?? null,
      lines: (s.lines ?? []).map((l: any) => ({
        product_id: l.product_id,
        product_name: l.product?.name ?? '—',
        qty: l.qty,
        plan_id: l.plan_id ?? null,
      })),
    }))
}

/**
 * What open deliveries plan for this store and no trip carries yet: planned −
 * shipped − what sits on a trip that has not left (taken from `incoming`).
 */
export async function getStorePlanned(db: Db, storeId: string, incoming: StoreShipment[]): Promise<StorePlanned[]> {
  const rows = await fetchAll<any>(() =>
    db
      .from('delivery_item_plan')
      .select(
        'id, planned_qty, shipped_qty, ' +
          'item:delivery_items!delivery_item_plan_delivery_item_id_fkey!inner(product_id, ' +
          'delivery:deliveries!delivery_items_delivery_id_fkey!inner(status), product:products(name))',
      )
      .eq('store_id', storeId)
      .in('item.delivery.status', OPEN_DELIVERY)
      .order('id'),
  )
  const onTrip = new Map<string, number>()
  for (const s of incoming) {
    if (s.status === 'sent') continue
    for (const l of s.lines) if (l.plan_id) onTrip.set(l.plan_id, (onTrip.get(l.plan_id) ?? 0) + l.qty)
  }
  return rows
    .filter(r => r.item?.delivery && OPEN_DELIVERY.includes(r.item.delivery.status))
    .map(r => ({
      product_id: r.item.product_id,
      product_name: r.item.product?.name ?? '—',
      qty: Math.max(0, r.planned_qty - r.shipped_qty - (onTrip.get(r.id) ?? 0)),
    }))
    .filter(r => r.qty > 0)
}

/** The store's incoming goods in one read: shipments and what is being prepared. */
export async function getStoreIncomingAll(db: Db, storeId: string | null) {
  if (!storeId) return { ships: [] as StoreShipment[], planned: [] as StorePlanned[] }
  const ships = await getStoreIncoming(db, storeId)
  const planned = await getStorePlanned(db, storeId, ships)
  return { ships, planned }
}

async function getAdminState(supabase: Db) {
  const [toReceive, plan, toLabel, unsent, trips, atStores, stores, problems] = await Promise.all([
    getWaitingToReceive(supabase),
    getOpenPlanRows(supabase),
    getLabelItems(supabase),
    getUnsentLines(supabase),
    getAdminTrips(supabase),
    getWaitingAtStores(supabase),
    getStoreOptions(supabase),
    countOpenProblems(supabase),
  ])
  const storeName = new Map(stores.map((s: any) => [s.id, s.name]))
  const warehouse = new Set(stores.filter((s: any) => s.is_warehouse).map((s: any) => s.id))
  const label = labelItems(toLabel, id => storeName.get(id) ?? '?')
  return {
    toReceive: toReceive.map(d => ({ id: d.id, number: d.number, units: d.units })),
    labelRows: label.length,
    labelUnits: label.reduce((n, r) => n + r.expected, 0),
    readyStores: readyByStore(plan, unsent)
      .filter(r => storeName.has(r.store_id) && !warehouse.has(r.store_id))
      .map(r => ({ name: storeName.get(r.store_id) as string, units: r.units }))
      .sort((a, b) => a.name.localeCompare(b.name, 'bg')),
    trips,
    problems,
    atStores: atStores.length,
  }
}

export async function getAdminTrips(supabase: Db): Promise<AdminTrip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('id, number, status, planned_date, planned_time, planned_driver_id, planned_driver:users!trips_planned_driver_id_fkey(display_name), ' +
      'shipments:shipments!shipments_trip_id_fkey(status, store:stores!shipments_store_id_fkey(name))')
    .eq('status', 'open')
    .order('number')
    .limit(200)
  if (error) throw error
  return (data ?? []).map((t: any) => ({
    id: t.id,
    number: t.number,
    status: t.status,
    planned_driver_id: t.planned_driver_id ?? null,
    planned_driver: t.planned_driver?.display_name ?? null,
    planned_date: t.planned_date ?? null,
    planned_time: hhmm(t.planned_time),
    shipments: (t.shipments ?? []).map((s: any) => ({ status: s.status, store: s.store?.name ?? undefined })),
  }))
}

export type NotificationRow = {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  created_at: string
  read_at: string | null
}

/** The person's latest notifications (RLS: only their own). */
export async function getNotifications(supabase: Db, userId: string, limit = 30): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link, created_at, read_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function countUnread(supabase: Db, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export type TasksFor = {
  role: 'admin' | 'seller'
  userId: string
  storeId: string | null
  /**
   * Has the Шофьор role: also sees every trip packed and waiting for transport,
   * not only the ones chosen for them (set from the roles, PR #11).
   */
  isDriver?: boolean
}

/**
 * Everything on "Задачи" for one person. Each part fails on its own: a missing
 * table (migration not run yet) leaves that part empty instead of the page.
 */
export async function loadTasks(supabase: Db, admin: Db, who: TasksFor): Promise<{ tasks: Task[]; notifications: NotificationRow[] }> {
  const today = sofiaToday()
  // Admins see "чака шофьора" on their own Офис cards; the pool is for the other drivers.
  const pool = who.isDriver && who.role !== 'admin'
  const [driving, store, office, notifications, poolTrips] = await Promise.all([
    getDriverTrips(admin, who.userId).catch(logEmpty<DriverTrip[]>('driver trips', [])),
    who.role === 'seller'
      ? getStoreIncomingAll(admin, who.storeId).catch(logEmpty('store incoming', { ships: [] as StoreShipment[], planned: [] as StorePlanned[] }))
      : Promise.resolve({ ships: [] as StoreShipment[], planned: [] as StorePlanned[] }),
    who.role === 'admin' ? getAdminState(supabase).catch(logEmpty('admin state', null)) : Promise.resolve(null),
    getNotifications(supabase, who.userId).catch(logEmpty<NotificationRow[]>('notifications', [])),
    pool ? getAdminTrips(admin).catch(logEmpty<AdminTrip[]>('driver pool', [])) : Promise.resolve([] as AdminTrip[]),
  ])
  const tasks = sortTasks([
    ...driverTasks(driving, today, { admin: who.role === 'admin' }),
    ...storeTasks(store.ships, store.planned, today),
    ...(office ? adminTasks(office, today) : []),
    ...driverPoolTasks(poolTrips, who.userId, today),
  ])
  return { tasks, notifications }
}

/**
 * The count beside "Задачи" in the menu, cheap enough for every page: unread
 * notifications, the person's own trips to drive, and (sellers) shipments to accept.
 */
export async function taskBadge(supabase: Db, admin: Db, who: TasksFor): Promise<number> {
  const today = sofiaToday()
  const [unread, driving] = await Promise.all([
    countUnread(supabase, who.userId).catch(() => 0),
    getDriverTrips(admin, who.userId).catch(() => [] as DriverTrip[]),
  ])
  return unread + actionCount(driverTasks(driving, today, { admin: who.role === 'admin' }))
}

function logEmpty<T>(what: string, empty: T) {
  return (e: unknown): T => {
    console.error(`tasks: ${what} failed:`, e instanceof Error ? e.message : JSON.stringify(e))
    return empty
  }
}
