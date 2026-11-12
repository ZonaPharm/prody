import { createAdminClient } from '@/lib/supabase/admin'
import { fetchByIds } from '@/lib/fetch-all'

/** Who packed, drove and accepted one shipment. */
export type ShipmentPeople = { packer: string | null; sender: string | null; receiver: string | null }

/**
 * Names of the people on the store's own shipments, for every seller of the store.
 *
 * A seller may read only their own row in `users` (RLS), so the names embedded in
 * a shipment come back empty for anyone but the person who did the step: a
 * colleague could not see who accepted a box. Call this only with ids the seller
 * has already read through their own session (RLS limits that to their store); it
 * then reads just the three names per shipment with the service key.
 */
export async function shipmentPeople(ids: string[]): Promise<Map<string, ShipmentPeople>> {
  const out = new Map<string, ShipmentPeople>()
  if (ids.length === 0) return out
  const admin = createAdminClient() as any
  const rows = await fetchByIds<any>(
    chunk => admin
      .from('shipments')
      .select(
        'id, packer:users!shipments_packed_by_fkey(display_name), sender:users!shipments_sent_by_fkey(display_name), ' +
          'receiver:users!shipments_received_by_fkey(display_name)',
      )
      .in('id', chunk),
    ids,
  )
  for (const r of rows) {
    out.set(r.id, {
      packer: r.packer?.display_name ?? null,
      sender: r.sender?.display_name ?? null,
      receiver: r.receiver?.display_name ?? null,
    })
  }
  return out
}

/** One line per product of a shipment: name, sent and accepted, for the list. */
export type ShipmentProductLine = { name: string; qty: number; received_qty: number | null }

/** What came in each shipment, read with the seller's own session. */
export async function shipmentProducts(supabase: any, ids: string[]): Promise<Map<string, ShipmentProductLine[]>> {
  const out = new Map<string, ShipmentProductLine[]>()
  if (ids.length === 0) return out
  const rows = await fetchByIds<any>(
    chunk => supabase
      .from('shipment_lines')
      .select('shipment_id, qty, received_qty, product:products!shipment_lines_product_id_fkey(name)')
      .in('shipment_id', chunk)
      .order('id'),
    ids,
    10, // a shipment has tens of lines: 10 shipments stay under the 1000-row limit
  )
  for (const r of rows) {
    const list = out.get(r.shipment_id) ?? []
    list.push({ name: r.product?.name ?? '?', qty: r.qty, received_qty: r.received_qty })
    out.set(r.shipment_id, list)
  }
  return out
}
