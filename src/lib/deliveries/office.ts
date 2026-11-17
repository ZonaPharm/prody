import { primaryImage } from './products'

/**
 * Office stock that can go into a shipment without a delivery ("Добави от Офис").
 * The numbers come from the database function office_free_stock, which
 * add_office_stock checks too: free = what Офис holds − what open deliveries still
 * need (store plans, Офис's unlabelled share) − Office lines already in a shipment.
 */
export type OfficeStockRow = {
  id: string
  name: string
  sku: string | null
  price: number | null
  image: string | null
  on_hand: number
  /** Bound to open deliveries: for the stores' plans or waiting for a label. */
  bound: number
  /** Already in a packing or packed shipment as Office stock. */
  held: number
  free: number
}

/** One row of office_free_stock(). */
export type OfficeFree = { product_id: string; on_hand: number; for_deliveries: number; in_shipments: number; free: number }

type RawProduct = {
  id: string
  name: string
  sku: string | null
  price: number | string | null
  images?: { url: string; is_primary: boolean | null; sort_order: number | null }[] | null
}

export function officeRows(products: RawProduct[], free: OfficeFree[]): OfficeStockRow[] {
  const byId = new Map(free.map(f => [f.product_id, f]))
  return products
    .map(p => {
      const f = byId.get(p.id)
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: p.price == null || p.price === '' ? null : Number(p.price),
        image: primaryImage(p.images),
        on_hand: f?.on_hand ?? 0,
        bound: f?.for_deliveries ?? 0,
        held: f?.in_shipments ?? 0,
        free: f?.free ?? 0,
      }
    })
    .sort((a, b) => Number(b.free > 0) - Number(a.free > 0) || a.name.localeCompare(b.name, 'bg'))
}

/** "в Офис 12 бр. · 2 за доставки · 4 чакат в пратки · свободни 6" */
export function officeStockText(r: Pick<OfficeStockRow, 'on_hand' | 'bound' | 'held' | 'free'>): string {
  if (r.on_hand === 0) return 'няма в Офис'
  const parts = [`в Офис ${r.on_hand} бр.`]
  if (r.bound > 0) parts.push(`${r.bound} за доставки`)
  if (r.held > 0) parts.push(`${r.held} чакат в пратки`)
  parts.push(`свободни ${r.free}`)
  return parts.join(' · ')
}
