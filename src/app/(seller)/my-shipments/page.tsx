import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { getStoreShipments } from '@/lib/deliveries/work'
import { daysWaiting } from '@/lib/deliveries/queue'
import { formatShipmentNumber } from '@/lib/deliveries/format'
import { SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE, boxesText } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** "Пратки": what Офис sent to this store. The ones on the way wait for the store's checklist. */
export default async function MyShipmentsPage() {
  if (!deliveriesActive()) notFound()
  const user = await requireAuth()
  const supabase = await createServerSupabaseClient()
  const rows = user.store_id ? await getStoreShipments(supabase, user.store_id) : []
  const waiting = rows.filter(r => r.status === 'sent')
  const done = rows.filter(r => r.status !== 'sent')

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Пратки</h1>
        <p className="text-sm text-muted-foreground">
          Стоката от Офис. Тя е във Вашата наличност от момента, в който шофьорът тръгне. Когато кашоните пристигнат, отметнете пратката ред по ред.
        </p>
      </div>

      {!user.store_id && (
        <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Акаунтът Ви не е към обект, затова няма пратки.</p>
      )}

      {user.store_id && (
        <section className="space-y-2">
          <h2 className="font-semibold">Чакат потвърждение ({waiting.length})</h2>
          {waiting.length === 0 ? (
            <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Няма пратки на път.</p>
          ) : (
            <ul className="rounded-lg border bg-white divide-y">
              {waiting.map(r => {
                const days = daysWaiting(r.sent_at)
                return (
                  <li key={r.id}>
                    <Link href={`/my-shipments/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50" data-testid="waiting-shipment">
                      <span className="font-semibold tabular-nums">{formatShipmentNumber(r.number)}</span>
                      <span className="text-sm">{r.lines} {r.lines === 1 ? 'ред' : 'реда'}, {r.units} бр.{r.box_count ? `, ${boxesText(r.box_count)}` : ''}</span>
                      <span className="text-sm text-muted-foreground">
                        тръгнала {r.sent_at ? sofiaDateTime(r.sent_at) : '—'}{r.sender ? `, шофьор ${r.sender}` : ''}
                      </span>
                      {days >= 1 && <span className="text-xs text-amber-700">чака от {days} {days === 1 ? 'ден' : 'дни'}</span>}
                      <span className="ml-auto text-sm font-medium text-blue-700">Отметни →</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Приети</h2>
          <ul className="rounded-lg border bg-white divide-y">
            {done.slice(0, 50).map(r => (
              <li key={r.id}>
                <Link href={`/my-shipments/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                  <span className="font-semibold tabular-nums">{formatShipmentNumber(r.number)}</span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', SHIPMENT_STATUS_TONE[r.status])}>{SHIPMENT_STATUS_LABEL[r.status]}</span>
                  <span>{r.units} бр.</span>
                  <span className="text-muted-foreground">{r.received_at ? sofiaDateTime(r.received_at) : ''}{r.receiver ? `, ${r.receiver}` : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
