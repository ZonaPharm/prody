import { fetchAll } from '@/lib/fetch-all'
import { primaryImage } from './products'
import type { LabelItemRow, QueuePlanRow, UnsentLine } from './queue'

/**
 * Reads for the phase 3 pages (labelling, trips, packing, problems, the
 * stores' shipments). Admin pages read with the admin's own session (admin
 * read policies); the store pages read with the seller's session, which RLS
 * limits to the seller's own store. Writes go through the API routes.
 *
 * Embeds name their foreign key where more than one path joins two tables.
 */

const OPEN_DELIVERY = ['expected', 'in_progress']
const UNSENT = ['packing', 'packed']

// ---------------------------------------------------------------------------
// Plan rows of open deliveries (labelling queue, ready per store)
// ---------------------------------------------------------------------------

export async function getOpenPlanRows(supabase: any): Promise<QueuePlanRow[]> {
  const rows = await fetchAll<any>(() =>
    supabase
      .from('delivery_item_plan')
      .select(
        'id, store_id, planned_qty, ready_qty, shipped_qty, ' +
          'item:delivery_items!delivery_item_plan_delivery_item_id_fkey!inner(id, received_qty, sort_order, product_id, ' +
          'delivery:deliveries!delivery_items_delivery_id_fkey!inner(id, number, status), ' +
          'product:products(name, sku, price, needs_label, images:product_images(url, is_primary, sort_order)))',
      )
      .in('item.delivery.status', OPEN_DELIVERY)
      .order('id'),
  )
  return rows
    .filter(r => r.item?.delivery && OPEN_DELIVERY.includes(r.item.delivery.status))
    .map(r => ({
      plan_id: r.id,
      store_id: r.store_id,
      planned_qty: r.planned_qty,
      ready_qty: r.ready_qty,
      shipped_qty: r.shipped_qty,
      item_id: r.item.id,
      received_qty: r.item.received_qty,
      sort_order: r.item.sort_order ?? 0,
      delivery_id: r.item.delivery.id,
      delivery_number: r.item.delivery.number,
      product_id: r.item.product_id,
      product_name: r.item.product?.name ?? '—',
      product_sku: r.item.product?.sku ?? null,
      product_price: r.item.product?.price == null ? null : Number(r.item.product.price),
      needs_label: r.item.product?.needs_label !== false,
      image: primaryImage(r.item.product?.images),
    }))
}

/**
 * Delivery lines with received units still without a label ("Етикетиране"), of any
 * delivery that is not a draft or cancelled: units staying in Офис get labelled too,
 * also after the stores have their shipments. unlabelled_qty is generated in the
 * database (received − labelled), so the filter runs there.
 */
export async function getLabelItems(supabase: any): Promise<LabelItemRow[]> {
  const rows = await fetchAll<any>(() =>
    supabase
      .from('delivery_items')
      .select(
        'id, received_qty, labelled_qty, sort_order, product_id, ' +
          'delivery:deliveries!delivery_items_delivery_id_fkey!inner(id, number, status), ' +
          'product:products(name, sku, price, needs_label, images:product_images(url, is_primary, sort_order)), ' +
          'plan:delivery_item_plan!delivery_item_plan_delivery_item_id_fkey(store_id, planned_qty, ready_qty)',
      )
      .gt('unlabelled_qty', 0)
      .in('delivery.status', ['expected', 'in_progress', 'completed'])
      .order('id'),
  )
  return rows
    .filter(r => r.delivery && r.delivery.status !== 'cancelled' && r.delivery.status !== 'draft')
    .map(r => ({
      item_id: r.id,
      delivery_id: r.delivery.id,
      delivery_number: r.delivery.number,
      sort_order: r.sort_order ?? 0,
      product_id: r.product_id,
      product_name: r.product?.name ?? '—',
      product_sku: r.product?.sku ?? null,
      product_price: r.product?.price == null ? null : Number(r.product.price),
      needs_label: r.product?.needs_label !== false,
      image: primaryImage(r.product?.images),
      received_qty: r.received_qty,
      labelled_qty: r.labelled_qty ?? 0,
      plan: (r.plan ?? []).map((p: any) => ({ store_id: p.store_id, planned_qty: p.planned_qty, ready_qty: p.ready_qty })),
    }))
}

/** Lines already on a trip that has not left: create_trip will not take them again. */
export async function getUnsentLines(supabase: any): Promise<UnsentLine[]> {
  const rows = await fetchAll<any>(() =>
    supabase
      .from('shipment_lines')
      .select('id, plan_id, qty, shipment:shipments!shipment_lines_shipment_id_fkey!inner(status)')
      .in('shipment.status', UNSENT)
      .not('plan_id', 'is', null) // Office stock lines hold no plan row
      .order('id'),
  )
  return rows.map(r => ({ plan_id: r.plan_id, qty: r.qty }))
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export type TripStatus = 'open' | 'departed' | 'completed' | 'cancelled'
export type ShipmentStatus = 'packing' | 'packed' | 'sent' | 'received' | 'received_with_issues' | 'cancelled'

export type TripListRow = {
  id: string
  number: number
  status: TripStatus
  created_at: string
  departed_at: string | null
  completed_at: string | null
  creator: string | null
  driver: string | null
  notes: string | null
  shipments: { id: string; number: number; store_id: string; status: ShipmentStatus; lines: number; units: number }[]
}

const TRIP_SELECT =
  'id, number, status, notes, created_at, departed_at, completed_at, cancelled_at, cancel_reason, driver_id, ' +
  'creator:users!trips_created_by_fkey(display_name), driver:users!trips_driver_id_fkey(display_name), ' +
  'canceller:users!trips_cancelled_by_fkey(display_name)'

export async function getTrips(supabase: any, filter: 'active' | 'all'): Promise<TripListRow[]> {
  const trips = await fetchAll<any>(() => {
    let q = supabase
      .from('trips')
      .select(
        TRIP_SELECT +
          ', shipments:shipments!shipments_trip_id_fkey(id, number, store_id, status, lines:shipment_lines!shipment_lines_shipment_id_fkey(qty))',
      )
    if (filter === 'active') q = q.in('status', ['open', 'departed'])
    return q.order('number', { ascending: false })
  })
  return trips.map(t => ({
    id: t.id,
    number: t.number,
    status: t.status,
    created_at: t.created_at,
    departed_at: t.departed_at,
    completed_at: t.completed_at,
    creator: t.creator?.display_name ?? null,
    driver: t.driver?.display_name ?? null,
    notes: t.notes,
    shipments: (t.shipments ?? [])
      .map((s: any) => ({
        id: s.id,
        number: s.number,
        store_id: s.store_id,
        status: s.status,
        lines: (s.lines ?? []).length,
        units: (s.lines ?? []).reduce((n: number, l: any) => n + l.qty, 0),
      }))
      .sort((a: any, b: any) => a.number - b.number),
  }))
}

export type ShipmentLineView = {
  id: string
  /** Both null for a line of Office stock (no delivery, "Добави от Офис"). */
  plan_id: string | null
  delivery_item_id: string | null
  qty: number
  received_qty: number | null
  product_id: string
  product_name: string
  product_sku: string | null
  product_price: number | null
  image: string | null
  delivery_id: string | null
  delivery_number: number | null
}

export type ShipmentView = {
  id: string
  number: number
  trip_id: string
  store_id: string
  store_name: string
  status: ShipmentStatus
  box_count: number | null
  packed_at: string | null
  sent_at: string | null
  received_at: string | null
  packer: string | null
  sender: string | null
  receiver: string | null
  lines: ShipmentLineView[]
}

export type TripDetail = {
  id: string
  number: number
  status: TripStatus
  notes: string | null
  created_at: string
  departed_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  creator: string | null
  driver: string | null
  canceller: string | null
  shipments: ShipmentView[]
}

const SHIPMENT_SELECT =
  'id, number, trip_id, store_id, status, box_count, packed_at, sent_at, received_at, ' +
  'store:stores!shipments_store_id_fkey(name), ' +
  'packer:users!shipments_packed_by_fkey(display_name), sender:users!shipments_sent_by_fkey(display_name), ' +
  'receiver:users!shipments_received_by_fkey(display_name)'

/** Admin view of shipment lines: with the delivery number each line came from. */
const LINE_SELECT_ADMIN =
  'id, shipment_id, plan_id, delivery_item_id, qty, received_qty, product_id, ' +
  'product:products!shipment_lines_product_id_fkey(name, sku, price, images:product_images(url, is_primary, sort_order)), ' +
  'item:delivery_items!shipment_lines_delivery_item_id_fkey(delivery:deliveries!delivery_items_delivery_id_fkey(id, number))'

/** Store view: sellers cannot read deliveries, so no delivery number. */
const LINE_SELECT_STORE =
  'id, shipment_id, plan_id, delivery_item_id, qty, received_qty, product_id, ' +
  'product:products!shipment_lines_product_id_fkey(name, sku, price, images:product_images(url, is_primary, sort_order))'

function toLine(l: any): ShipmentLineView {
  return {
    id: l.id,
    plan_id: l.plan_id,
    delivery_item_id: l.delivery_item_id,
    qty: l.qty,
    received_qty: l.received_qty,
    product_id: l.product_id,
    product_name: l.product?.name ?? '—',
    product_sku: l.product?.sku ?? null,
    product_price: l.product?.price == null ? null : Number(l.product.price),
    image: primaryImage(l.product?.images),
    delivery_id: l.item?.delivery?.id ?? null,
    delivery_number: l.item?.delivery?.number ?? null,
  }
}

function toShipment(s: any, lines: any[]): ShipmentView {
  return {
    id: s.id,
    number: s.number,
    trip_id: s.trip_id,
    store_id: s.store_id,
    store_name: s.store?.name ?? '—',
    status: s.status,
    box_count: s.box_count,
    packed_at: s.packed_at,
    sent_at: s.sent_at,
    received_at: s.received_at,
    packer: s.packer?.display_name ?? null,
    sender: s.sender?.display_name ?? null,
    receiver: s.receiver?.display_name ?? null,
    lines: lines
      .filter(l => l.shipment_id === s.id)
      .map(toLine)
      .sort((a, b) => a.product_name.localeCompare(b.product_name, 'bg') || (a.delivery_number ?? 0) - (b.delivery_number ?? 0)),
  }
}

async function linesOfShipments(supabase: any, shipmentIds: string[], select: string): Promise<any[]> {
  if (shipmentIds.length === 0) return []
  // A trip has a handful of shipments; one .in() on their ids stays short.
  return fetchAll<any>(() => supabase.from('shipment_lines').select(select).in('shipment_id', shipmentIds).order('id'))
}

export async function getTripDetail(supabase: any, id: string): Promise<TripDetail | null> {
  const { data: t, error } = await supabase.from('trips').select(TRIP_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  if (!t) return null
  const { data: ships, error: e2 } = await supabase.from('shipments').select(SHIPMENT_SELECT).eq('trip_id', id).order('number')
  if (e2) throw e2
  const lines = await linesOfShipments(supabase, (ships ?? []).map((s: any) => s.id), LINE_SELECT_ADMIN)
  return {
    id: t.id,
    number: t.number,
    status: t.status,
    notes: t.notes,
    created_at: t.created_at,
    departed_at: t.departed_at,
    completed_at: t.completed_at,
    cancelled_at: t.cancelled_at,
    cancel_reason: t.cancel_reason,
    creator: t.creator?.display_name ?? null,
    driver: t.driver?.display_name ?? null,
    canceller: t.canceller?.display_name ?? null,
    shipments: (ships ?? []).map((s: any) => toShipment(s, lines)).sort((a: ShipmentView, b: ShipmentView) => a.store_name.localeCompare(b.store_name, 'bg')),
  }
}

/** One shipment with its lines. store=true reads as a seller (no delivery numbers). */
export async function getShipment(supabase: any, id: string, opts: { store?: boolean } = {}): Promise<(ShipmentView & { trip_number: number | null; trip_status: TripStatus | null }) | null> {
  const { data: s, error } = await supabase
    .from('shipments')
    .select(SHIPMENT_SELECT + (opts.store ? '' : ', trip:trips!shipments_trip_id_fkey(number, status)'))
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!s) return null
  const lines = await linesOfShipments(supabase, [s.id], opts.store ? LINE_SELECT_STORE : LINE_SELECT_ADMIN)
  return { ...toShipment(s, lines), trip_number: s.trip?.number ?? null, trip_status: s.trip?.status ?? null }
}

// ---------------------------------------------------------------------------
// The stores' side
// ---------------------------------------------------------------------------

export type StoreShipmentRow = {
  id: string
  trip_id: string
  number: number
  status: ShipmentStatus
  box_count: number | null
  sent_at: string | null
  received_at: string | null
  sender: string | null
  receiver: string | null
  lines: number
  units: number
}

/** Shipments to one store that have left Офис (sent, received). RLS limits a seller to their store. */
export async function getStoreShipments(supabase: any, storeId: string): Promise<StoreShipmentRow[]> {
  const rows = await fetchAll<any>(() =>
    supabase
      .from('shipments')
      .select(
        'id, trip_id, number, status, box_count, sent_at, received_at, ' +
          'sender:users!shipments_sent_by_fkey(display_name), receiver:users!shipments_received_by_fkey(display_name), ' +
          'lines:shipment_lines!shipment_lines_shipment_id_fkey(qty)',
      )
      .eq('store_id', storeId)
      .in('status', ['sent', 'received', 'received_with_issues'])
      .order('number', { ascending: false }),
  )
  return rows.map(r => ({
    id: r.id,
    trip_id: r.trip_id,
    number: r.number,
    status: r.status,
    box_count: r.box_count,
    sent_at: r.sent_at,
    received_at: r.received_at,
    sender: r.sender?.display_name ?? null,
    receiver: r.receiver?.display_name ?? null,
    lines: (r.lines ?? []).length,
    units: (r.lines ?? []).reduce((n: number, l: any) => n + l.qty, 0),
  }))
}

/** How many shipments wait for this store's checklist (the seller menu badge). */
export async function countWaitingShipments(supabase: any, storeId: string | null): Promise<number> {
  if (!storeId) return 0
  const { count } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'sent')
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Problems (signals across all deliveries)
// ---------------------------------------------------------------------------

export type ProblemRow = {
  id: string
  step: string
  reason: string
  status: 'open' | 'resolved'
  qty_expected: number | null
  qty_actual: number | null
  note: string | null
  resolution: string | null
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
  creator: string | null
  resolver: string | null
  delivery_id: string | null
  delivery_number: number | null
  product_name: string | null
  shipment_id: string | null
  shipment_number: number | null
  store_name: string | null
  trip_id: string | null
  /** Who signed along the way, for a shipment signal: packed, driver, received. */
  signed: { step: string; name: string }[]
}

export async function getProblems(supabase: any, filter: 'open' | 'all'): Promise<ProblemRow[]> {
  const rows = await fetchAll<any>(() => {
    let q = supabase
      .from('delivery_signals')
      .select(
        'id, step, reason, status, qty_expected, qty_actual, note, resolution, resolution_note, created_at, resolved_at, ' +
          'creator:users!delivery_signals_created_by_fkey(display_name), resolver:users!delivery_signals_resolved_by_fkey(display_name), ' +
          'delivery:deliveries!delivery_signals_delivery_id_fkey(id, number), ' +
          'item:delivery_items!delivery_signals_delivery_item_id_fkey(product:products(name)), ' +
          'line:shipment_lines!delivery_signals_shipment_line_id_fkey(product:products!shipment_lines_product_id_fkey(name)), ' +
          'shipment:shipments!delivery_signals_shipment_id_fkey(id, number, trip_id, store:stores!shipments_store_id_fkey(name), ' +
          'packer:users!shipments_packed_by_fkey(display_name), sender:users!shipments_sent_by_fkey(display_name), ' +
          'receiver:users!shipments_received_by_fkey(display_name))',
      )
    if (filter === 'open') q = q.eq('status', 'open')
    return q.order('created_at', { ascending: false }).order('id')
  })
  return rows.map(r => {
    const sh = r.shipment
    const signed: { step: string; name: string }[] = []
    if (sh?.packer?.display_name) signed.push({ step: 'опаковал', name: sh.packer.display_name })
    if (sh?.sender?.display_name) signed.push({ step: 'шофьор', name: sh.sender.display_name })
    if (sh?.receiver?.display_name) signed.push({ step: 'приел в обекта', name: sh.receiver.display_name })
    return {
      id: r.id,
      step: r.step,
      reason: r.reason,
      status: r.status,
      qty_expected: r.qty_expected,
      qty_actual: r.qty_actual,
      note: r.note,
      resolution: r.resolution,
      resolution_note: r.resolution_note,
      created_at: r.created_at,
      resolved_at: r.resolved_at,
      creator: r.creator?.display_name ?? null,
      resolver: r.resolver?.display_name ?? null,
      delivery_id: r.delivery?.id ?? null,
      delivery_number: r.delivery?.number ?? null,
      product_name: r.item?.product?.name ?? r.line?.product?.name ?? null,
      shipment_id: sh?.id ?? null,
      shipment_number: sh?.number ?? null,
      store_name: sh?.store?.name ?? null,
      trip_id: sh?.trip_id ?? null,
      signed,
    }
  })
}

export async function countOpenProblems(supabase: any): Promise<number> {
  const { count } = await supabase.from('delivery_signals').select('id', { count: 'exact', head: true }).eq('status', 'open')
  return count ?? 0
}

// ---------------------------------------------------------------------------
// "За работа": what waits at each step
// ---------------------------------------------------------------------------

export type WaitingToReceive = { id: string; number: number | null; status: string; units: number; lines: number }
export type WaitingAtStore = { id: string; number: number; store_id: string; trip_id: string; sent_at: string | null }

export async function getWaitingToReceive(supabase: any): Promise<WaitingToReceive[]> {
  const rows = await fetchAll<any>(() =>
    supabase
      .from('deliveries')
      .select('id, number, status, items:delivery_items!delivery_items_delivery_id_fkey(quantity, received_qty)')
      .in('status', OPEN_DELIVERY)
      .order('number'),
  )
  return rows
    .map(d => {
      const open = (d.items ?? []).filter((i: any) => i.received_qty < i.quantity)
      return {
        id: d.id,
        number: d.number,
        status: d.status,
        lines: open.length,
        units: open.reduce((n: number, i: any) => n + (i.quantity - i.received_qty), 0),
      }
    })
    .filter(d => d.lines > 0)
}

export async function getWaitingAtStores(supabase: any): Promise<WaitingAtStore[]> {
  const rows = await fetchAll<any>(() =>
    supabase.from('shipments').select('id, number, store_id, trip_id, sent_at').eq('status', 'sent').order('sent_at'),
  )
  return rows
}

export type DriverOption = { id: string; name: string }

/** Active accounts that can sign as the driver (any role: every person has their own account). */
export async function getDriverOptions(supabase: any): Promise<DriverOption[]> {
  const { data } = await supabase.from('users').select('id, display_name, is_active').order('display_name').limit(1000)
  return (data ?? [])
    .filter((u: any) => u.is_active !== false)
    .map((u: any) => ({ id: u.id, name: u.display_name }))
}
