import { supplierForSource, type SupplierRef } from './suppliers'

/**
 * A product as the delivery entry screen needs it: what to show in the search
 * and the catalogue, and what to fill in when it is added to a line
 * (supplier and cost of its last delivery; for products from before
 * deliveries, the supplier from "Източник" and the catalogue cost).
 */

export type DeliveryProduct = {
  id: string
  name: string
  sku: string | null
  status: string
  price: number | null
  quantity_on_hand: number
  needs_label: boolean
  image: string | null
  suggested: { supplier_id: string | null; unit_cost: number | null; pack_size: number }
}

export const PRODUCT_COLUMNS =
  'id, name, sku, status, price, cost_price, source, needs_label, quantity_on_hand, images:product_images(url, is_primary, sort_order)'

type RawProduct = {
  id: string
  name: string
  sku: string | null
  status: string
  price: number | string | null
  cost_price: number | string | null
  source: string | null
  needs_label: boolean | null
  quantity_on_hand: number | null
  images?: { url: string; is_primary: boolean | null; sort_order: number | null }[] | null
}

export type LastLine = { product_id: string; supplier_id: string | null; unit_cost: number | string; pack_size: number }

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function primaryImage(images: RawProduct['images']): string | null {
  if (!images || images.length === 0) return null
  const sorted = [...images].sort((a, b) => {
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1
    return (a.sort_order ?? 0) - (b.sort_order ?? 0)
  })
  return sorted[0]?.url ?? null
}

/**
 * lastLines: delivery lines of these products, newest first (only the first
 * per product counts).
 */
export function toDeliveryProducts(
  products: RawProduct[],
  lastLines: LastLine[],
  suppliers: SupplierRef[],
): DeliveryProduct[] {
  const last = new Map<string, LastLine>()
  for (const l of lastLines) if (!last.has(l.product_id)) last.set(l.product_id, l)
  const activeIds = new Set(suppliers.filter(s => s.is_active !== false).map(s => s.id))

  return products.map(p => {
    const l = last.get(p.id)
    let supplierId: string | null = null
    if (l?.supplier_id && activeIds.has(l.supplier_id)) supplierId = l.supplier_id
    else if (!l) supplierId = supplierForSource(p.source, suppliers.filter(s => s.is_active !== false))?.id ?? null
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      status: p.status,
      price: num(p.price),
      quantity_on_hand: p.quantity_on_hand ?? 0,
      needs_label: p.needs_label !== false,
      image: primaryImage(p.images),
      suggested: {
        supplier_id: supplierId,
        unit_cost: l ? num(l.unit_cost) : num(p.cost_price),
        pack_size: l?.pack_size && l.pack_size > 0 ? l.pack_size : 1,
      },
    }
  })
}

/** Text typed in the search, made safe for a PostgREST or=(…) filter. */
export function searchPattern(q: string): string | null {
  const cleaned = q.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length < 2) return null
  return `%${cleaned}%`
}

/** Fetch what toDeliveryProducts needs besides the products themselves. */
export async function loadSuggestions(
  supabase: any,
  productIds: string[],
): Promise<{ lastLines: LastLine[]; suppliers: SupplierRef[] }> {
  const [{ data: lastLines }, { data: suppliers }] = await Promise.all([
    productIds.length
      ? supabase
          .from('delivery_items')
          .select('product_id, supplier_id, unit_cost, pack_size, created_at, delivery:deliveries!inner(status)')
          .in('product_id', productIds)
          .not('delivery.status', 'in', '(cancelled,draft)') // a draft is not a delivery yet
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
    supabase.from('suppliers').select('id, name, is_active').order('name').limit(1000),
  ])
  return { lastLines: (lastLines ?? []) as LastLine[], suppliers: (suppliers ?? []) as SupplierRef[] }
}
