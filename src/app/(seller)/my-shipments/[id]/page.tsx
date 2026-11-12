import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { isUuid } from '@/lib/deliveries/api'
import { getShipment } from '@/lib/deliveries/work'
import { formatShipmentNumber } from '@/lib/deliveries/format'
import { SHIPMENT_STATUS_LABEL, boxesText } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { ShipmentChecklist } from '@/components/deliveries/shipment-checklist'

export const dynamic = 'force-dynamic'

/**
 * The store's checklist for one shipment. Read with the seller's own session:
 * RLS shows only shipments of the seller's store, so another store's id is a 404.
 */
export default async function MyShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  if (!deliveriesActive()) notFound()
  const user = await requireAuth()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const shipment = await getShipment(supabase, id, { store: true })
  if (!shipment || shipment.store_id !== user.store_id) notFound()
  if (!['sent', 'received', 'received_with_issues'].includes(shipment.status)) notFound()

  const units = shipment.lines.reduce((n, l) => n + l.qty, 0)

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/my-shipments" aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl font-bold">Пратка {formatShipmentNumber(shipment.number)}</h1>
          <p className="text-sm text-muted-foreground">
            {shipment.store_name} · {shipment.lines.length} {shipment.lines.length === 1 ? 'ред' : 'реда'}, {units} бр.
            {shipment.box_count ? `, ${boxesText(shipment.box_count)}` : ''}
            {shipment.sent_at ? ` · тръгнала ${sofiaDateTime(shipment.sent_at)}` : ''}
            {shipment.sender ? `, шофьор ${shipment.sender}` : ''}
          </p>
        </div>
      </div>

      {shipment.status === 'sent' ? (
        <ShipmentChecklist
          mode="store"
          shipmentId={shipment.id}
          number={shipment.number}
          storeName={shipment.store_name}
          lines={shipment.lines}
          userName={user.display_name}
          doneHref="/my-shipments"
        />
      ) : (
        <div className="rounded-lg border bg-white">
          <p className="border-b px-4 py-2 text-sm">
            {SHIPMENT_STATUS_LABEL[shipment.status]}
            {shipment.received_at ? `, ${sofiaDateTime(shipment.received_at)}` : ''}
            {shipment.receiver ? ` от ${shipment.receiver}` : ''}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {shipment.lines.map(l => (
                <tr key={l.id} className="border-t first:border-t-0">
                  <td className="px-4 py-2">{l.product_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {l.received_qty ?? l.qty} от {l.qty} бр.
                    {l.received_qty != null && l.received_qty < l.qty && <span className="ml-1 text-red-700">липсват {l.qty - l.received_qty}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
