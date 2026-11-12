import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { primaryImage } from '@/lib/deliveries/products'
import { supplierForSource, type SupplierRef } from '@/lib/deliveries/suppliers'
import type { OrderStatus } from './format'

/**
 * Reads for the "Поръчки" screens (admins, through their own session; RLS lets
 * admins read the order tables). Writes go through the API routes.
 */

export type OrderFilter = 'open' | 'received' | 'cancelled' | 'all'

export type SupplierContact = {
  id: string
  name: string
  is_active: boolean
  order_emails: string[]
  contact_name: string | null
  phone: string | null
}

export type OrderListRow = {
  id: string
  number: number
  status: OrderStatus
  supplier_name: string
  created_at: string
  sent_at: string | null
  sent_via: 'email' | 'manual' | null
  received_at: string | null
  delivery_id: string | null
  delivery_number: number | null
  creator: string | null
  lines: number
  units: number
}

const SUPPLIER_COLUMNS = 'id, name, is_active, order_emails, contact_name, phone'

export function toContact(s: any): SupplierContact {
  return {
    id: s.id,
    name: s.name,
    is_active: s.is_active !== false,
    order_emails: Array.isArray(s.order_emails) ? s.order_emails : [],
    contact_name: s.contact_name ?? null,
    phone: s.phone ?? null,
  }
}

export async function getSupplierContacts(supabase: any): Promise<SupplierContact[]> {
  const { data } = await supabase.from('suppliers').select(SUPPLIER_COLUMNS).order('name').limit(1000)
  return (data ?? []).map(toContact)
}

export async function getOrdersList(supabase: any, filter: OrderFilter): Promise<OrderListRow[]> {
  let q = supabase
    .from('supplier_orders')
    .select(
      'id, number, status, created_at, sent_at, sent_via, received_at, delivery_id, ' +
        'supplier:suppliers(name), ' +
        'creator:users!supplier_orders_created_by_fkey(display_name), ' +
        'delivery:deliveries!supplier_orders_delivery_id_fkey(number), ' +
        'items:supplier_order_items(quantity)',
    )
    .order('created_at', { ascending: false })
    .limit(300)
  if (filter === 'open') q = q.in('status', ['draft', 'sent'])
  else if (filter !== 'all') q = q.eq('status', filter)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    supplier_name: r.supplier?.name ?? '—',
    created_at: r.created_at,
    sent_at: r.sent_at,
    sent_via: r.sent_via,
    received_at: r.received_at,
    delivery_id: r.delivery_id,
    delivery_number: r.delivery?.number ?? null,
    creator: r.creator?.display_name ?? null,
    lines: (r.items ?? []).length,
    units: (r.items ?? []).reduce((n: number, i: any) => n + (i.quantity ?? 0), 0),
  }))
}

export type OrderProduct = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  status: string
  quantity_on_hand: number
  image: string | null
}

export type OrderDetailLine = { product: OrderProduct; quantity: number; note: string | null }

export type OrderDetail = {
  id: string
  number: number
  status: OrderStatus
  notes: string | null
  updated_at: string
  created_at: string
  creator: string | null
  sent_at: string | null
  sender: string | null
  sent_via: 'email' | 'manual' | null
  sent_to: string[]
  send_count: number
  received_at: string | null
  delivery_id: string | null
  delivery_number: number | null
  delivery_status: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  supplier: SupplierContact
  lines: OrderDetailLine[]
}

const PRODUCT_COLUMNS = 'id, name, sku, barcode, status, quantity_on_hand, images:product_images(url, is_primary, sort_order)'

export function toOrderProduct(p: any): OrderProduct {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    barcode: p.barcode ?? null,
    status: p.status,
    quantity_on_hand: p.quantity_on_hand ?? 0,
    image: primaryImage(p.images),
  }
}

export async function getOrderDetail(supabase: any, id: string): Promise<OrderDetail | null> {
  const { data: o, error } = await supabase
    .from('supplier_orders')
    .select(
      '*, supplier:suppliers(' + SUPPLIER_COLUMNS + '), ' +
        'creator:users!supplier_orders_created_by_fkey(display_name), ' +
        'sender:users!supplier_orders_sent_by_fkey(display_name), ' +
        'delivery:deliveries!supplier_orders_delivery_id_fkey(number, status), ' +
        'items:supplier_order_items(quantity, note, sort_order, product:products(' + PRODUCT_COLUMNS + '))',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!o) return null
  const items = [...(o.items ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order)
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    notes: o.notes,
    updated_at: o.updated_at,
    created_at: o.created_at,
    creator: o.creator?.display_name ?? null,
    sent_at: o.sent_at,
    sender: o.sender?.display_name ?? null,
    sent_via: o.sent_via,
    sent_to: o.sent_to ?? [],
    send_count: o.send_count ?? 0,
    received_at: o.received_at,
    delivery_id: o.delivery_id,
    delivery_number: o.delivery?.number ?? null,
    delivery_status: o.delivery?.status ?? null,
    cancelled_at: o.cancelled_at,
    cancel_reason: o.cancel_reason,
    supplier: toContact(o.supplier ?? { id: o.supplier_id, name: '—' }),
    lines: items.map((i: any) => ({ product: toOrderProduct(i.product), quantity: i.quantity, note: i.note })),
  }
}

export type SupplierProduct = OrderProduct & {
  /** How many came (or were ordered) the last time, a hint for the new order. */
  last_qty: number | null
  last_at: string | null
}

/**
 * What we usually take from this supplier: products of its deliveries and orders,
 * plus older products whose "Източник" names it. Newest first is the hint; the
 * list itself is by name.
 */
export async function getSupplierProducts(supabase: any, supplierId: string): Promise<SupplierProduct[]> {
  const [lines, orderLines, suppliers] = await Promise.all([
    fetchAll<any>(() =>
      supabase
        .from('delivery_items')
        .select('product_id, quantity, created_at, delivery:deliveries!inner(status)')
        .eq('supplier_id', supplierId)
        .not('delivery.status', 'in', '(cancelled,draft)')
        .order('created_at', { ascending: false }),
    ),
    fetchAll<any>(() =>
      supabase
        .from('supplier_order_items')
        .select('product_id, quantity, order:supplier_orders!inner(supplier_id, status, created_at)')
        .eq('order.supplier_id', supplierId)
        .neq('order.status', 'cancelled')
        .order('id'),
    ),
    supabase.from('suppliers').select('id, name, is_active').limit(1000),
  ])

  const last = new Map<string, { qty: number; at: string }>()
  const remember = (pid: string, qty: number, at: string) => {
    const cur = last.get(pid)
    if (!cur || cur.at < at) last.set(pid, { qty, at })
  }
  for (const l of lines) remember(l.product_id, l.quantity, l.created_at)
  for (const l of orderLines) remember(l.product_id, l.quantity, l.order?.created_at ?? '')

  // Products from before deliveries: their free-text "Източник".
  const supplierRefs = (suppliers.data ?? []) as SupplierRef[]
  const bySource = await fetchAll<any>(() =>
    supabase.from('products').select('id, source').not('source', 'is', null).order('id'),
  )
  const ids = new Set(last.keys())
  for (const p of bySource) {
    if (supplierForSource(p.source, supplierRefs)?.id === supplierId) ids.add(p.id)
  }
  if (ids.size === 0) return []

  const products = await fetchByIds<any>(
    chunk => supabase.from('products').select(PRODUCT_COLUMNS).in('id', chunk),
    [...ids],
  )
  return products
    .map(p => ({ ...toOrderProduct(p), last_qty: last.get(p.id)?.qty ?? null, last_at: last.get(p.id)?.at ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
}

/**
 * The order a delivery was made from, with its lines, for the draft delivery's
 * "поръчани: N". Null when the delivery did not come from an order (or the
 * order tables are not there yet).
 */
export async function getOrderForDelivery(
  supabase: any,
  deliveryId: string,
): Promise<{ id: string; number: number; lines: { product_id: string; name: string; quantity: number }[] } | null> {
  const { data, error } = await supabase
    .from('supplier_orders')
    .select('id, number, items:supplier_order_items(product_id, quantity, sort_order, product:products(name))')
    .eq('delivery_id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id,
    number: data.number,
    lines: [...(data.items ?? [])]
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((i: any) => ({ product_id: i.product_id, name: i.product?.name ?? '', quantity: i.quantity })),
  }
}
