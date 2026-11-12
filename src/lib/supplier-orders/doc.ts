import { supplierBarcode, type OrderDoc } from './format'
import type { OrderDetail } from './queries'

/** The order as the supplier sees it: e-mail, print and copied text all start here. */
export function orderDocFrom(o: OrderDetail, signature: string | null, senderName: string): OrderDoc {
  return {
    number: o.number,
    supplierName: o.supplier.name,
    contactName: o.supplier.contact_name,
    notes: o.notes,
    signature,
    senderName,
    lines: o.lines.map(l => ({
      name: l.product.name,
      barcode: supplierBarcode(l.product.barcode),
      quantity: l.quantity,
      note: l.note,
    })),
  }
}

/** The signature at the end of every order (email_settings.order_signature). */
export async function getOrderSignature(supabase: any): Promise<string | null> {
  const { data } = await supabase.from('email_settings').select('order_signature').eq('id', 1).maybeSingle()
  return data?.order_signature ?? null
}
