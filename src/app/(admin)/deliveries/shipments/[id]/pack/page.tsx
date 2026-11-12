import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { getShipment } from '@/lib/deliveries/work'
import { formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { ShipmentChecklist } from '@/components/deliveries/shipment-checklist'

export const dynamic = 'force-dynamic'

export default async function PackShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDeliveriesAdmin()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const shipment = await getShipment(supabase, id)
  if (!shipment) notFound()
  if (shipment.status !== 'packing' || shipment.trip_status !== 'open') redirect(`/deliveries/trips/${shipment.trip_id}`)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon"><Link href={`/deliveries/trips/${shipment.trip_id}`} aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl font-bold">Опаковане · {shipment.store_name}</h1>
          <p className="text-sm text-muted-foreground">
            Пратка {formatShipmentNumber(shipment.number)} в курс {formatTripNumber(shipment.trip_number)}. Отметнете всеки ред, който е в кашоните. Ако нещо липсва или е повредено, „Не е наред“.
          </p>
        </div>
      </div>
      <ShipmentChecklist
        mode="pack"
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
