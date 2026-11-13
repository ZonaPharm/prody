import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { getTripDetail } from '@/lib/deliveries/work'
import { formatDeliveryNumber, formatMoney, formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { boxesText } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { PrintButton } from '@/components/deliveries/print-button'

export const dynamic = 'force-dynamic'

/**
 * The printed list of a trip: one page per store (or one shipment with
 * ?shipment=), lines by product with the delivery number beside each, a box
 * to tick, and lines for the signatures. The driver and the seller work from it.
 * Outside the admin layout, so only the sheet prints.
 */
export default async function TripPrintPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ shipment?: string }>
}) {
  await requireDeliveriesAdmin()
  const { id } = await params
  const { shipment } = await searchParams
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const trip = await getTripDetail(supabase, id)
  if (!trip) notFound()
  const shipments = trip.shipments.filter(s => s.status !== 'cancelled' && (!shipment || s.id === shipment))
  if (shipments.length === 0) notFound()

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-muted-foreground">Курс {formatTripNumber(trip.number)} · {shipments.length} {shipments.length === 1 ? 'страница' : 'страници'}</span>
        <PrintButton />
      </div>
      {shipments.map((s, i) => {
        const units = s.lines.reduce((n, l) => n + l.qty, 0)
        return (
          <section key={s.id} className={i < shipments.length - 1 ? 'mb-10 break-after-page' : ''}>
            <div className="flex items-baseline justify-between border-b-2 border-black pb-1">
              <h1 className="text-xl font-bold">{s.store_name}</h1>
              <span className="font-semibold">Пратка {formatShipmentNumber(s.number)} · Курс {formatTripNumber(trip.number)}</span>
            </div>
            <p className="mt-1">
              {s.lines.length} {s.lines.length === 1 ? 'ред' : 'реда'}, {units} бр.{s.box_count ? `, ${boxesText(s.box_count)}` : ''}
              {trip.departed_at ? ` · тръгнал ${sofiaDateTime(trip.departed_at)}` : ` · отпечатан ${sofiaDateTime(new Date())}`}
            </p>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="w-8 py-1"></th>
                  <th className="py-1">Продукт</th>
                  <th className="py-1">Доставка</th>
                  <th className="py-1 text-right">Цена</th>
                  <th className="py-1 text-right">Бр.</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map(l => (
                  <tr key={l.id} className="border-b border-slate-300">
                    <td className="py-1.5"><span className="inline-block h-4 w-4 border border-black" /></td>
                    <td className="py-1.5">{l.product_name}{l.product_sku ? <span className="text-xs text-slate-600"> · {l.product_sku}</span> : null}</td>
                    <td className="py-1.5 whitespace-nowrap">{l.plan_id == null ? 'от Офис' : formatDeliveryNumber(l.delivery_number)}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">{formatMoney(l.product_price)}</td>
                    <td className="py-1.5 text-right font-semibold">{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-8 grid grid-cols-3 gap-6">
              {[
                ['Опаковал', s.packer],
                ['Шофьор', s.sender ?? trip.driver],
                ['Приел в обекта', s.receiver],
              ].map(([label, name]) => (
                <div key={label as string}>
                  <div className="h-10 border-b border-black" />
                  <div className="mt-1 text-xs">{label}{name ? `: ${name}` : ''}</div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
