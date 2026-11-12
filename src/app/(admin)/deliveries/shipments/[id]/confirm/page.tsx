import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { getShipment } from '@/lib/deliveries/work'
import { formatShipmentNumber } from '@/lib/deliveries/format'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { ShipmentChecklist } from '@/components/deliveries/shipment-checklist'
import { PageHeader } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

/** An admin ticks a store's shipment in its place (e.g. the store has no account yet). Signed by the admin. */
export default async function ConfirmShipmentAsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDeliveriesAdmin()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const shipment = await getShipment(supabase, id)
  if (!shipment) notFound()
  if (shipment.status !== 'sent') redirect(`/deliveries/trips/${shipment.trip_id}`)

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader
        back={<Button asChild variant="ghost" size="icon"><Link href={`/deliveries/trips/${shipment.trip_id}`} aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>}
        title={<>Приемане вместо {shipment.store_name}</>}
        intro={<>Пратка {formatShipmentNumber(shipment.number)}. Обикновено я отмята продавачът от „Пратки“. Тук подписвате Вие, с Вашето име.</>}
      />
      <ShipmentChecklist
        mode="store"
        shipmentId={shipment.id}
        number={shipment.number}
        storeName={shipment.store_name}
        lines={shipment.lines}
        userName={user.display_name}
        doneHref={`/deliveries/trips/${shipment.trip_id}`}
      />
    </div>
  )
}
