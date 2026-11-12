import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions } from '@/lib/deliveries/queries'
import {
  countOpenProblems,
  getLabelItems,
  getOpenPlanRows,
  getTrips,
  getUnsentLines,
  getWaitingAtStores,
  getWaitingToReceive,
} from '@/lib/deliveries/work'
import { daysWaiting, labelItems, readyByStore, storeReadyText } from '@/lib/deliveries/queue'
import { formatDeliveryNumber, formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { tripReadyToSend } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'

export const dynamic = 'force-dynamic'

/**
 * "За работа": what waits at each step across all open deliveries, so nobody
 * works delivery by delivery. Each card leads to the checklist of its step.
 */
export default async function WorkPage() {
  await requireDeliveriesAdmin({ adminOnly: true })
  const supabase = await createServerSupabaseClient()
  const [toReceive, plan, toLabel, unsent, trips, atStores, stores, problems] = await Promise.all([
    getWaitingToReceive(supabase),
    getOpenPlanRows(supabase),
    getLabelItems(supabase),
    getUnsentLines(supabase),
    getTrips(supabase, 'active'),
    getWaitingAtStores(supabase),
    getStoreOptions(supabase),
    countOpenProblems(supabase),
  ])
  const storeName = new Map(stores.map(s => [s.id, s.name]))
  const name = (id: string) => storeName.get(id) ?? '?'
  const label = labelItems(toLabel, name)
  const labelUnits = label.reduce((n, r) => n + r.expected, 0)
  const ready = readyByStore(plan, unsent)
    .filter(s => storeName.has(s.store_id))
    .sort((a, b) => name(a.store_id).localeCompare(name(b.store_id), 'bg'))
  const openTrips = trips.filter(t => t.status === 'open' && !tripReadyToSend(t.shipments))
  // Packed and signed for: only the driver is missing. Shown on its own so everyone sees it.
  const forDriver = trips.filter(t => t.status === 'open' && tripReadyToSend(t.shipments))

  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="work" problems={problems} />
      <div>
        <h1 className="text-2xl font-bold">За работа</h1>
        <p className="text-sm text-muted-foreground">Какво чака на всяка стъпка, от всички отворени доставки.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="За получаване" count={toReceive.length} unit={toReceive.length === 1 ? 'доставка' : 'доставки'}>
          {toReceive.slice(0, 8).map(d => (
            <Row key={d.id} href={`/deliveries/${d.id}/receive`} left={formatDeliveryNumber(d.number)} right={`чакат ${d.units} бр. по ${d.lines} ${d.lines === 1 ? 'ред' : 'реда'}`} />
          ))}
        </Card>

        <Card title="За етикет" count={label.length} unit={label.length === 1 ? 'ред' : 'реда'} href="/deliveries/labels" action="Етикетиране">
          {label.length > 0 && <p className="px-4 py-2 text-sm text-muted-foreground">{labelUnits} бр. в Офис чакат етикет, за магазините и за Офис.</p>}
        </Card>

        <Card title="За изпращане" count={ready.length} unit={ready.length === 1 ? 'магазин' : 'магазина'} href="/deliveries/trips" action="Нов курс" empty={ready.length === 0 && openTrips.length === 0}>
          {ready.map(s => <Row key={s.store_id} href="/deliveries/trips" left={name(s.store_id)} right={storeReadyText(s)} />)}
          {openTrips.map(t => (
            <Row key={t.id} href={`/deliveries/trips/${t.id}`} left={formatTripNumber(t.number)}
              right={`Опакова се: ${t.shipments.filter(s => s.status === 'packed').length} от ${t.shipments.length} пратки опаковани`} />
          ))}
        </Card>

        <Card title="Чакат шофьор" count={forDriver.length} unit={forDriver.length === 1 ? 'курс' : 'курса'} empty={forDriver.length === 0}>
          {forDriver.length > 0 && <p className="px-4 pt-2 text-xs text-muted-foreground">Всичко е опаковано. Стоката чака транспорт: шофьорът подписва в курса и тръгва.</p>}
          {forDriver.map(t => {
            const live = t.shipments.filter(s => s.status !== 'cancelled')
            return (
              <Row key={t.id} href={`/deliveries/trips/${t.id}`} left={formatTripNumber(t.number)}
                right={`до ${live.map(s => name(s.store_id)).join(', ')} · ${live.reduce((n, s) => n + s.units, 0)} бр.`} />
            )
          })}
        </Card>

        <Card title="Чакат потвърждение от магазин" count={atStores.length} unit={atStores.length === 1 ? 'пратка' : 'пратки'}>
          {atStores.slice(0, 10).map(s => {
            const days = daysWaiting(s.sent_at)
            return (
              <Row key={s.id} href={`/deliveries/trips/${s.trip_id}`} left={`${formatShipmentNumber(s.number)} ${name(s.store_id)}`}
                right={`от ${s.sent_at ? sofiaDateTime(s.sent_at) : '—'}${days >= 1 ? ` (${days} ${days === 1 ? 'ден' : 'дни'})` : ''}`} warn={days >= 3} />
            )
          })}
        </Card>

        <Card title="Проблеми" count={problems} unit={problems === 1 ? 'отворен' : 'отворени'} href="/deliveries/problems" action="Към проблемите" danger={problems > 0} />
      </div>
    </div>
  )
}

function Card({ title, count, unit, href, action, danger, empty, children }: {
  title: string
  empty?: boolean
  count: number
  unit: string
  href?: string
  action?: string
  danger?: boolean
  children?: React.ReactNode
}) {
  return (
    <section className={`rounded-lg border bg-white ${danger ? 'border-red-200' : ''}`}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <span className={`whitespace-nowrap text-sm ${danger ? 'text-red-700 font-semibold' : 'text-muted-foreground'}`}>{count} {unit}</span>
        {href && action && <Link href={href} className="ml-auto whitespace-nowrap text-sm font-medium text-primary hover:underline">{action} →</Link>}
      </header>
      <div className="divide-y">{children}</div>
      {(empty ?? count === 0) && <p className="px-4 py-3 text-sm text-muted-foreground">Нищо не чака.</p>}
    </section>
  )
}

function Row({ href, left, right, warn }: { href: string; left: string; right: string; warn?: boolean }) {
  return (
    <Link href={href} className="flex flex-wrap items-center gap-x-2 px-4 py-2 text-sm hover:bg-slate-50">
      <span className="font-medium">{left}</span>
      <span className={`ml-auto text-right ${warn ? 'text-amber-700' : 'text-muted-foreground'}`}>{right}</span>
    </Link>
  )
}
