import { splitForSupplier, supplierBarcode, type OrderDoc } from './format'
import type { OrderDetail } from './queries'

type StoreRef = { id: string; name: string; is_warehouse: boolean }

/**
 * The order as the supplier sees it: e-mail, print and copied text all start here.
 * The split per store is in it only when the order says so (share_plan) and the
 * stores are given.
 */
export function orderDocFrom(o: OrderDetail, signature: string | null, senderName: string, stores: StoreRef[] = []): OrderDoc {
  const split = o.share_plan ? splitForSupplier(o.lines, stores) : null
  return {
    number: o.number,
    supplierName: o.supplier.name,
    contactName: o.supplier.contact_name,
    notes: o.notes,
    signature,
    senderName,
    split: split ? { columns: split.columns } : null,
    lines: o.lines.map((l, i) => ({
      name: l.product.name,
      barcode: supplierBarcode(l.product.barcode),
      quantity: l.quantity,
      note: l.note,
      ...(split ? { split: split.rows[i] } : {}),
    })),
  }
}

/** The signature at the end of every order (email_settings.order_signature). */
export async function getOrderSignature(supabase: any): Promise<string | null> {
  const { data } = await supabase.from('email_settings').select('order_signature').eq('id', 1).maybeSingle()
  return data?.order_signature ?? null
}
