'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Truck } from 'lucide-react'
import { formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { storeReadyText, type StoreReady } from '@/lib/deliveries/queue'
import type { TripListRow } from '@/lib/deliveries/work'
import { TRIP_STATUS_LABEL, TRIP_STATUS_TONE, SHIPMENT_STATUS_LABEL } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { postJson } from './checklist-ui'

export type StoreReadyView = StoreReady & { name: string }

/**
 * "Курсове": the trips (К-…) with their shipments, and "Нов курс": tick the
 * stores on the driver's way; each gets one shipment with everything ready
 * for it now, from every open delivery. A store with nothing ready is skipped.
 */
export function TripsBoard({ trips, ready, storeName, filter }: {
  trips: TripListRow[]
  ready: StoreReadyView[]
  storeName: Record<string, string>
  filter: 'active' | 'all'
}) {
  const router = useRouter()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true)
    setError('')
    try {
      const data = await postJson<{ trip_id: string }>('/api/deliveries/trips', { store_ids: [...picked], notes: notes.trim() || null }, 'Курсът не беше създаден')
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
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Plus className="h-4 w-4" />
          <h2 className="font-semibold">Нов курс</h2>
          <span className="text-sm text-muted-foreground">Отметнете магазините по пътя на машината.</span>
        </header>
        {ready.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Няма готова стока за изпращане. Първо отметнете готовите редове в <Link href="/deliveries/labels" className="underline">„Етикетиране“</Link>.
          </p>
        ) : (
          <div className="p-4 space-y-3">
            <ul className="grid gap-2 sm:grid-cols-2">
              {ready.map(s => (
                <li key={s.store_id}>
                  <label className={cn('flex items-start gap-3 rounded-md border p-3 cursor-pointer', picked.has(s.store_id) && 'border-slate-900 bg-slate-50')}>
                    <input type="checkbox" className="mt-0.5 h-5 w-5" checked={picked.has(s.store_id)} onChange={e => toggle(s.store_id, e.target.checked)} aria-label={s.name} />
                    <span>
                      <span className="font-medium">{s.name}</span>
                      <span className="block text-sm text-muted-foreground">{storeReadyText(s)}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="max-w-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Бележка (по избор), напр. шофьор, час" aria-label="Бележка" />
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
                className={cn('px-3 py-1 text-sm rounded', filter === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
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
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', TRIP_STATUS_TONE[t.status])}>{TRIP_STATUS_LABEL[t.status]}</span>
                  <span className="text-sm text-muted-foreground">
                    {sofiaDateTime(t.departed_at ?? t.created_at)}{t.driver ? ` · шофьор ${t.driver}` : ''}
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
