import { fetchAll } from '@/lib/fetch-all'
import type { DeliveryStatus } from './format'
import { primaryImage } from './products'
import type { TrackLine } from './track'

/**
 * Reads for the delivery pages, with the signed-in admin's client (admins have
 * read policies on every delivery table). Writes never come through here: they
 * go through the API routes and the database functions.
 *
 * Embeds name their foreign key: delivery_events and delivery_signals link
 * deliveries, lines and plan rows to each other, so PostgREST would otherwise
 * see several paths between the same tables and refuse the query.
 */

export type ListFilter = 'open' | 'completed' | 'cancelled' | 'all'

const FILTER_STATUSES: Record<ListFilter, DeliveryStatus[]> = {
  open: ['draft', 'expected', 'in_progress'],
  completed: ['completed'],
  cancelled: ['cancelled'],
  all: ['draft', 'expected', 'in_progress', 'completed', 'cancelled'],
}

export type DeliveryListRow = {
  id: string
  number: number | null
  status: DeliveryStatus
  order_ref: string | null
  created_at: string
  creator: string | null
  suppliers: string[]
  docs: string[]
  lines: number
  units: number
  received: number
  value: number
  open_signals: number
}

type RawListRow = {
  id: string
  number: number | null
  status: DeliveryStatus
  order_ref: string | null
  created_at: string
  creator: { display_name: string } | null
  items: { quantity: number; received_qty: number; unit_cost: number | string; doc_number: string | null; supplier: { name: string } | null }[] | null
  signals: { status: string }[] | null
}

export function toListRow(d: RawListRow): DeliveryListRow {
  const items = d.items ?? []
  const suppliers = [...new Set(items.map(i => i.supplier?.name).filter((n): n is string => !!n))]
  const docs = [...new Set(items.map(i => i.doc_number).filter((n): n is string => !!n))]
  return {
    id: d.id,
    number: d.number,
    status: d.status,
    order_ref: d.order_ref,
    created_at: d.created_at,
    creator: d.creator?.display_name ?? null,
    suppliers,
    docs,
    lines: items.length,
    units: items.reduce((s, i) => s + i.quantity, 0),
    received: items.reduce((s, i) => s + i.received_qty, 0),
    value: items.reduce((s, i) => s + i.quantity * Number(i.unit_cost), 0),
    open_signals: (d.signals ?? []).filter(s => s.status === 'open').length,
  }
}

export async function getDeliveriesList(supabase: any, filter: ListFilter): Promise<DeliveryListRow[]> {
  const rows = await fetchAll<RawListRow>(() =>
    supabase
      .from('deliveries')
      .select(
        'id, number, status, order_ref, created_at, ' +
          'creator:users!deliveries_created_by_fkey(display_name), ' +
          'items:delivery_items!delivery_items_delivery_id_fkey(quantity, received_qty, unit_cost, doc_number, supplier:suppliers(name)), ' +
          'signals:delivery_signals!delivery_signals_delivery_id_fkey(status)',
      )
      .in('status', FILTER_STATUSES[filter])
      .order('created_at', { ascending: false })
      .order('id'),
  )
  return rows.map(toListRow)
}

export type DetailItem = {
  id: string
  product_id: string
  product_name: string
  product_sku: string | null
  product_price: number | null
  product_status: string
  needs_label: boolean
  image: string | null
  supplier_id: string | null
  supplier_name: string | null
  doc_number: string | null
  pack_size: number
  quantity: number
  unit_cost: number
  received_qty: number
  /** Units labelled (or needing no label); the rest of received_qty waits in "Етикетиране". */
  labelled_qty: number
  sort_order: number
  plan: { id: string; store_id: string; planned_qty: number; ready_qty: number; shipped_qty: number }[]
}

export type DetailEvent = {
  id: string
  type: string
  qty: number | null
  details: Record<string, unknown>
  created_at: string
  delivery_item_id: string | null
  store_id: string | null
  user_name: string | null
}

export type DetailSignal = {
  id: string
  delivery_item_id: string | null
  step: string
  reason: string
  qty_expected: number | null
  qty_actual: number | null
  note: string | null
  status: 'open' | 'resolved'
  resolution: string | null
  resolution_note: string | null
  created_at: string
  resolved_at: string | null
  creator: string | null
  resolver: string | null
}

export type DeliveryDetail = {
  id: string
  number: number | null
  status: DeliveryStatus
  order_ref: string | null
  notes: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  creator: string | null
  items: DetailItem[]
  events: DetailEvent[]
  signals: DetailSignal[]
  /** Shipment lines of this delivery (any trip), for "Къде е сега". */
  ship_lines: TrackLine[]
}

export async function getDeliveryDetail(supabase: any, id: string): Promise<DeliveryDetail | null> {
  const { data: d, error } = await supabase
    .from('deliveries')
    .select('id, number, status, order_ref, notes, created_at, updated_at, completed_at, cancelled_at, cancel_reason, creator:users!deliveries_created_by_fkey(display_name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!d) return null

  const [items, plan, events, signals, shipLines] = await Promise.all([
    fetchAll<any>(() =>
      supabase
        .from('delivery_items')
        .select(
          'id, product_id, supplier_id, doc_number, pack_size, quantity, unit_cost, received_qty, labelled_qty, sort_order, ' +
            'product:products(name, sku, price, status, needs_label, images:product_images(url, is_primary, sort_order)), ' +
            'supplier:suppliers(name)',
        )
        .eq('delivery_id', id)
        .order('sort_order')
        .order('id'),
    ),
    fetchAll<any>(() =>
      supabase
        .from('delivery_item_plan')
        .select('id, delivery_item_id, store_id, planned_qty, ready_qty, shipped_qty, item:delivery_items!delivery_item_plan_delivery_item_id_fkey!inner(delivery_id)')
        .eq('item.delivery_id', id)
        .order('id'),
    ),
    fetchAll<any>(() =>
      supabase
        .from('delivery_events')
        .select('id, type, qty, details, created_at, delivery_item_id, store_id, user:users!delivery_events_created_by_fkey(display_name)')
        .eq('delivery_id', id)
        .order('created_at', { ascending: false })
        .order('id'),
    ),
    fetchAll<any>(() =>
      supabase
        .from('delivery_signals')
        .select(
          'id, delivery_item_id, step, reason, qty_expected, qty_actual, note, status, resolution, resolution_note, created_at, resolved_at, ' +
            'creator:users!delivery_signals_created_by_fkey(display_name), resolver:users!delivery_signals_resolved_by_fkey(display_name)',
        )
        .eq('delivery_id', id)
        .order('created_at', { ascending: false })
        .order('id'),
    ),
    fetchAll<any>(() =>
      supabase
        .from('shipment_lines')
        .select(SHIP_LINE_SELECT + ', item:delivery_items!shipment_lines_delivery_item_id_fkey!inner(delivery_id)')
        .eq('item.delivery_id', id)
        .order('id'),
    ),
  ])

  const planByItem = new Map<string, DetailItem['plan']>()
  for (const p of plan) {
    const list = planByItem.get(p.delivery_item_id) ?? []
    list.push({ id: p.id, store_id: p.store_id, planned_qty: p.planned_qty, ready_qty: p.ready_qty, shipped_qty: p.shipped_qty })
    planByItem.set(p.delivery_item_id, list)
  }

  return {
    id: d.id,
    number: d.number,
    status: d.status,
    order_ref: d.order_ref,
    notes: d.notes,
    created_at: d.created_at,
    updated_at: d.updated_at,
    completed_at: d.completed_at,
    cancelled_at: d.cancelled_at,
    cancel_reason: d.cancel_reason,
    creator: d.creator?.display_name ?? null,
    items: items.map((i: any) => ({
      id: i.id,
      product_id: i.product_id,
      product_name: i.product?.name ?? '—',
      product_sku: i.product?.sku ?? null,
      product_price: i.product?.price == null ? null : Number(i.product.price),
      product_status: i.product?.status ?? 'active',
      needs_label: i.product?.needs_label !== false,
      image: primaryImage(i.product?.images),
      supplier_id: i.supplier_id,
      supplier_name: i.supplier?.name ?? null,
      doc_number: i.doc_number,
      pack_size: i.pack_size,
      quantity: i.quantity,
      unit_cost: Number(i.unit_cost),
      received_qty: i.received_qty,
      labelled_qty: i.labelled_qty ?? 0,
      sort_order: i.sort_order,
      plan: planByItem.get(i.id) ?? [],
    })),
    events: events.map((e: any) => ({
      id: e.id,
      type: e.type,
      qty: e.qty,
      details: e.details ?? {},
      created_at: e.created_at,
      delivery_item_id: e.delivery_item_id,
      store_id: e.store_id,
      user_name: e.user?.display_name ?? null,
    })),
    signals: signals.map((s: any) => ({
      id: s.id,
      delivery_item_id: s.delivery_item_id,
      step: s.step,
      reason: s.reason,
      qty_expected: s.qty_expected,
      qty_actual: s.qty_actual,
      note: s.note,
      status: s.status,
      resolution: s.resolution,
      resolution_note: s.resolution_note,
      created_at: s.created_at,
      resolved_at: s.resolved_at,
      creator: s.creator?.display_name ?? null,
      resolver: s.resolver?.display_name ?? null,
    })),
    ship_lines: shipLines.map(toTrackLine),
  }
}

const SHIP_LINE_SELECT =
  'id, plan_id, qty, received_qty, delivery_item_id, ' +
  'shipment:shipments!shipment_lines_shipment_id_fkey!inner(id, number, status, trip_id, trip:trips!shipments_trip_id_fkey(number))'

function toTrackLine(l: any): TrackLine & { delivery_item_id: string } {
  return {
    plan_id: l.plan_id,
    delivery_item_id: l.delivery_item_id,
    qty: l.qty,
    received_qty: l.received_qty,
    shipment_id: l.shipment?.id,
    shipment_number: l.shipment?.number ?? null,
    shipment_status: l.shipment?.status,
    trip_id: l.shipment?.trip_id,
    trip_number: l.shipment?.trip?.number ?? null,
  }
}

/** One delivery line of a product, as the product page shows it under "Доставки". */
export type ProductDeliveryLine = {
  item_id: string
  delivery_id: string
  delivery_number: number | null
  delivery_status: DeliveryStatus
  created_at: string
  supplier_name: string | null
  doc_number: string | null
  quantity: number
  received_qty: number
  labelled_qty: number
  plan: DetailItem['plan']
  ship_lines: TrackLine[]
}

/**
 * The latest delivery lines of one product (drafts left out), with their plan and
 * shipment lines, so the product page can say where each lot is now.
 */
const SHOWN_STATUSES = ['expected', 'in_progress', 'completed']

export async function getProductDeliveries(supabase: any, productId: string, limit = 10): Promise<ProductDeliveryLine[]> {
  const { data: items, error } = await supabase
    .from('delivery_items')
    .select(
      'id, quantity, received_qty, labelled_qty, doc_number, created_at, supplier:suppliers(name), ' +
        'delivery:deliveries!delivery_items_delivery_id_fkey!inner(id, number, status, created_at), ' +
        'plan:delivery_item_plan!delivery_item_plan_delivery_item_id_fkey(id, store_id, planned_qty, ready_qty, shipped_qty)',
    )
    .eq('product_id', productId)
    .in('delivery.status', SHOWN_STATUSES)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(limit)
  if (error) throw error
  // The embedded filter already leaves drafts and cancelled out; checked again here so
  // a draft can never show as "the latest delivery" of a product.
  const rows = ((items ?? []) as any[]).filter(i => i.delivery && SHOWN_STATUSES.includes(i.delivery.status))
  if (rows.length === 0) return []

  // At most `limit` ids, far below the URL limit of .in().
  const { data: lines, error: linesError } = await supabase
    .from('shipment_lines')
    .select(SHIP_LINE_SELECT)
    .in('delivery_item_id', rows.map(r => r.id))
    .order('id')
  if (linesError) throw linesError
  const byItem = new Map<string, TrackLine[]>()
  for (const l of (lines ?? []) as any[]) {
    const list = byItem.get(l.delivery_item_id) ?? []
    list.push(toTrackLine(l))
    byItem.set(l.delivery_item_id, list)
  }

  return rows.map(r => ({
    item_id: r.id,
    delivery_id: r.delivery.id,
    delivery_number: r.delivery.number,
    delivery_status: r.delivery.status,
    created_at: r.delivery.created_at,
    supplier_name: r.supplier?.name ?? null,
    doc_number: r.doc_number,
    quantity: r.quantity,
    received_qty: r.received_qty,
    labelled_qty: r.labelled_qty ?? 0,
    plan: (r.plan ?? []).map((p: any) => ({ id: p.id, store_id: p.store_id, planned_qty: p.planned_qty, ready_qty: p.ready_qty, shipped_qty: p.shipped_qty })),
    ship_lines: byItem.get(r.id) ?? [],
  }))
}

export type StoreOption = { id: string; name: string; is_warehouse: boolean }

export async function getStoreOptions(supabase: any): Promise<StoreOption[]> {
  const { data } = await supabase.from('stores').select('id, name, is_warehouse, is_active').eq('is_active', true).order('name')
  return (data ?? []).map((s: any) => ({ id: s.id, name: s.name, is_warehouse: !!s.is_warehouse }))
}

export async function getSupplierOptions(supabase: any): Promise<{ id: string; name: string; is_active: boolean }[]> {
  const { data } = await supabase.from('suppliers').select('id, name, is_active').order('name').limit(1000)
  return data ?? []
}
