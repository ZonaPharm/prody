import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getDeliveryDetail } from '@/lib/deliveries/queries'
import { isUuid } from '@/lib/deliveries/api'
import { ReceiveChecklist } from '@/components/deliveries/receive-checklist'

export const dynamic = 'force-dynamic'

export default async function ReceiveDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDeliveriesAdmin({ adminOnly: true })
  const { id } = await params
  if (!isUuid(id)) notFound()

  const supabase = await createServerSupabaseClient()
  const delivery = await getDeliveryDetail(supabase, id)
  if (!delivery) notFound()
  if (delivery.status !== 'expected' && delivery.status !== 'in_progress') redirect(`/deliveries/${id}`)

  const rows = delivery.items
    .filter(i => i.received_qty < i.quantity)
    .map(i => ({
      item_id: i.id,
      product_name: i.product_name,
      product_sku: i.product_sku,
      image: i.image,
      supplier_name: i.supplier_name,
      doc_number: i.doc_number,
      pack_size: i.pack_size,
      quantity: i.quantity,
      received_qty: i.received_qty,
      remaining: i.quantity - i.received_qty,
      needs_label: i.needs_label,
    }))

  return <ReceiveChecklist deliveryId={delivery.id} number={delivery.number} rows={rows} userName={user.display_name} />
}
