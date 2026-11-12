'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Truck } from 'lucide-react'
import { formatDeliveryNumber, formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { storeReadyText, type ReadyLine, type StoreReady } from '@/lib/deliveries/queue'
import type { DriverOption, TripListRow } from '@/lib/deliveries/work'
import { whenText } from '@/lib/deliveries/notify-text'
import { TRIP_STATUS_TONE, SHIPMENT_STATUS_LABEL, tripStatusLabel } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { postJson } from './checklist-ui'
import { NextStep } from './step-trail'

export type StoreReadyView = StoreReady & { name: string; lines?: ReadyLine[] }

/**
 * "Курсове": the trips (К-…) with their shipments, and "Нов курс": tick the
 * stores on the driver's way; each gets one shipment with everything ready
 * for it now, from every open delivery. A store with nothing ready is skipped.
 */
export function TripsBoard({ trips, ready, storeName, filter, waitingLabel = 0, drivers = [], today }: {
  /** Units planned for stores that still wait for "С етикет" + signature. */
  waitingLabel?: number
  /** Who can drive (every active account); the chosen one gets a notification. */
  drivers?: DriverOption[]
  /** Today in Sofia (YYYY-MM-DD), from the server. */
  today: string
  trips: TripListRow[]
  ready: StoreReadyView[]
  storeName: Record<string, string>
  filter: 'active' | 'all'
}) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [driver, setDriver] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tomorrow = addDays(today, 1)

  async function create() {
    setBusy(true)
    setError('')
    try {
      const data = await postJson<{ trip_id: string; warning?: string }>('/api/deliveries/trips', {
        store_ids: [...picked],
        notes: notes.trim() || null,
        driver_id: driver || null,
        planned_date: date || null,
        planned_time: date && time ? time : null,
      }, 'Курсът не беше създаден')
      if (data.warning) window.alert(data.warning)
      router.push(`/deliveries/trips/${data.trip_id}`)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }

  function toggle(id: string, on: boolean) {
    setPicked(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border bg-white">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-4 py-3">
          <Plus className="h-4 w-4" />
          <h2 className="font-semibold">Нов курс</h2>
          <span className="w-full text-sm text-muted-foreground sm:w-auto">Отметнете магазините по пътя на машината.</span>
        </header>
        {ready.length === 0 ? (
          <div className="space-y-3 p-4 text-sm">
            <p className="text-muted-foreground">
              Още няма стока, готова за магазините, затова няма от какво да се направи курс.
              {waitingLabel > 0
                ? ` За магазините чакат етикет ${waitingLabel} бр. Те стават готови, когато в „Етикетиране“ натиснете „С етикет“ на реда и подпишете.`
                : ' Стоката става готова, когато е получена в Офис, разпределена към магазин и подписана в „Етикетиране“.'}
            </p>
            {waitingLabel > 0 && <NextStep next={{ label: `Етикетирай ${waitingLabel} бр. за магазините`, href: '/deliveries/labels' }} />}
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <ul className="grid gap-2 sm:grid-cols-2">
              {ready.map(s => (
                <li key={s.store_id} className={cn('rounded-md border', picked.has(s.store_id) && 'border-primary bg-primary/5')}>
                  <label className="flex items-start gap-3 p-3 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 h-5 w-5" checked={picked.has(s.store_id)} onChange={e => toggle(s.store_id, e.target.checked)} aria-label={s.name} />
                    <span>
                      <span className="font-medium">{s.name}</span>
                      <span className="block text-sm text-muted-foreground">{storeReadyText(s)}</span>
                    </span>
                  </label>
                  {s.lines && s.lines.length > 0 && (
                    <details className="border-t px-3 py-2 text-sm">
                      <summary className="cursor-pointer text-primary">Какво чака за {s.name}</summary>
                      <ul className="mt-1 space-y-0.5">
                        {s.lines.map(l => (
                          <li key={l.plan_id} className="flex gap-2">
                            <span className="min-w-0 flex-1 truncate">{l.product_name}</span>
                            <Link href={`/deliveries/${l.delivery_id}`} className="shrink-0 text-xs text-muted-foreground hover:underline">{formatDeliveryNumber(l.delivery_number)}</Link>
                            <span className="w-14 shrink-0 text-right font-semibold tabular-nums">{l.qty} бр.</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            <fieldset className="grid gap-3 rounded-md border bg-slate-50 p-3 sm:grid-cols-2">
              <legend className="px-1 text-sm font-semibold">Шофьор и ден</legend>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Кой кара</span>
                <select className="h-11 w-full rounded-md border border-input bg-white px-2 text-sm" value={driver} onChange={e => setDriver(e.target.value)} aria-label="Шофьор">
                  <option value="">Избери по-късно</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <div className="space-y-1 text-sm">
                <span className="block font-medium">Кога тръгва</span>
                <div className="flex flex-wrap items-center gap-2">
                  {([[today, 'Днес'], [tomorrow, 'Утре']] as const).map(([d, label]) => (
                    <button key={label} type="button" onClick={() => setDate(date === d ? '' : d)}
                      className={cn('h-11 rounded-md border px-3 text-sm', date === d ? 'border-primary bg-primary text-primary-foreground' : 'bg-white')}>
                      {label}
                    </button>
                  ))}
                  <Input type="date" className="h-11 w-auto min-w-0 flex-1 bg-white" value={date} min={today} onChange={e => setDate(e.target.value)} aria-label="Ден" />
                  <Input type="time" className="h-11 w-28 bg-white" value={time} onChange={e => setTime(e.target.value)} disabled={!date} aria-label="Час (по избор)" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {driver || date
                  ? `${driver ? `${drivers.find(d => d.id === driver)?.name} ще получи известие` : 'Шофьорът ще бъде избран по-късно'}${date ? `: курс ${whenText(date, time || null, today)}` : ', без ден'}. Магазините виждат какво идва към тях и кога.`
                  : 'Шофьорът получава известие с деня и магазините, а магазините виждат какво идва към тях. Може и по-късно, от курса.'}
              </p>
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="max-w-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Бележка (по избор)" aria-label="Бележка" />
              <Button onClick={create} disabled={picked.size === 0 || busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                Направи курс{picked.size ? ` (${picked.size} ${picked.size === 1 ? 'магазин' : 'магазина'})` : ''}
              </Button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Курсове</h2>
          <div className="inline-flex rounded-md border bg-white p-0.5 ml-auto">
            {([['active', 'В ход'], ['all', 'Всички']] as const).map(([v, label]) => (
              <Link key={v} href={v === 'active' ? '/deliveries/trips' : '/deliveries/trips?filter=all'}
                className={cn('px-3 py-1 text-sm rounded', filter === v ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100')}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        {trips.length === 0 ? (
          <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Няма курсове.</p>
        ) : (
          <ul className="rounded-lg border bg-white divide-y">
            {trips.map(t => (
              <li key={t.id}>
                <Link href={`/deliveries/trips/${t.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="font-semibold tabular-nums">{formatTripNumber(t.number)}</span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', TRIP_STATUS_TONE[t.status])}>{tripStatusLabel(t.status, t.shipments)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t.status === 'open' && t.planned_date
                      ? `тръгва ${whenText(t.planned_date, t.planned_time, today)}`
                      : sofiaDateTime(t.departed_at ?? t.created_at)}
                    {t.driver ? ` · шофьор ${t.driver}` : t.planned_driver ? ` · шофьор ${t.planned_driver}` : t.status === 'open' ? ' · без шофьор' : ''}
                  </span>
                  <span className="basis-full sm:basis-auto sm:ml-auto flex flex-wrap gap-1">
                    {t.shipments.map(s => (
                      <span key={s.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs" title={SHIPMENT_STATUS_LABEL[s.status]}>
                        {formatShipmentNumber(s.number)} {storeName[s.store_id] ?? '?'} · {s.units} бр. · {SHIPMENT_STATUS_LABEL[s.status]}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** YYYY-MM-DD plus n calendar days. */
function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86_400_000)
  return d.toISOString().slice(0, 10)
}
