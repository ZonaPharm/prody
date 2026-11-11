'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowLeft, ClipboardCheck, Loader2, PackageCheck, PenLine, Printer, Truck, XCircle } from 'lucide-react'
import { formatDeliveryNumber, formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import {
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
  TRIP_STATUS_LABEL,
  TRIP_STATUS_TONE,
  boxesText,
  tripReadyToSend,
} from '@/lib/deliveries/trip-format'
import type { DriverOption, TripDetail } from '@/lib/deliveries/work'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { postJson, useNow } from './checklist-ui'

/**
 * One trip: its shipments by store, each packed with its own checklist; then
 * the driver signs for the boxes with their own password and the trip leaves
 * Офис in one go. A trip that has not left can be taken back.
 */
export function TripView({ trip, drivers }: { trip: TripDetail; drivers: DriverOption[] }) {
  const live = trip.shipments.filter(s => s.status !== 'cancelled')
  const canSend = trip.status === 'open' && tripReadyToSend(live)
  const boxes = live.reduce((n, s) => n + (s.box_count ?? 0), 0)
  const units = live.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.qty, 0), 0)
  const [sendOpen, setSendOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon"><Link href="/deliveries/trips" aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Курс {formatTripNumber(trip.number)}</h1>
              <span className={cn('rounded-full border px-2 py-0.5 text-xs', TRIP_STATUS_TONE[trip.status])}>{TRIP_STATUS_LABEL[trip.status]}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Създаден {sofiaDateTime(trip.created_at)}{trip.creator ? ` от ${trip.creator}` : ''}
              {trip.departed_at ? ` · тръгнал ${sofiaDateTime(trip.departed_at)}` : ''}
              {trip.driver ? ` · шофьор ${trip.driver}` : ''}
            </p>
            {trip.notes && <p className="text-sm mt-1">{trip.notes}</p>}
            {trip.status === 'cancelled' && (
              <p className="text-sm text-red-700 mt-1">Отказан{trip.canceller ? ` от ${trip.canceller}` : ''}{trip.cancelled_at ? `, ${sofiaDateTime(trip.cancelled_at)}` : ''}: {trip.cancel_reason}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {trip.status !== 'cancelled' && (
            <Button asChild variant="outline">
              <Link href={`/print/trip/${trip.id}`} target="_blank"><Printer className="mr-2 h-4 w-4" />Лист за курса</Link>
            </Button>
          )}
          {trip.status === 'open' && (
            <>
              <Button onClick={() => setSendOpen(true)} disabled={!canSend}><Truck className="mr-2 h-4 w-4" />Шофьорът подписва</Button>
              <Button variant="outline" onClick={() => setCancelOpen(true)}><XCircle className="mr-2 h-4 w-4" />Откажи курса</Button>
            </>
          )}
        </div>
      </div>

      {trip.status === 'open' && !canSend && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Курсът тръгва, когато всяка пратка е опакована и подписана. Опаковайте пратките по-долу.
        </p>
      )}

      <div className="space-y-3">
        {trip.shipments.map(s => {
          const sUnits = s.lines.reduce((n, l) => n + l.qty, 0)
          return (
            <section key={s.id} className={cn('rounded-lg border bg-white', s.status === 'cancelled' && 'opacity-60')}>
              <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                <span className="font-semibold">{s.store_name}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{formatShipmentNumber(s.number)}</span>
                <span className={cn('rounded-full border px-2 py-0.5 text-xs', SHIPMENT_STATUS_TONE[s.status])}>{SHIPMENT_STATUS_LABEL[s.status]}</span>
                <span className="text-sm text-muted-foreground">
                  {s.lines.length} {s.lines.length === 1 ? 'ред' : 'реда'}, {sUnits} бр.{s.box_count ? `, ${boxesText(s.box_count)}` : ''}
                </span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {s.status === 'packing' && trip.status === 'open' && (
                    <Button asChild size="sm"><Link href={`/deliveries/shipments/${s.id}/pack`}><PackageCheck className="mr-1 h-4 w-4" />Опаковай</Link></Button>
                  )}
                  {s.status === 'sent' && (
                    <Button asChild size="sm" variant="outline"><Link href={`/deliveries/shipments/${s.id}/confirm`}><ClipboardCheck className="mr-1 h-4 w-4" />Приеми вместо обекта</Link></Button>
                  )}
                  {s.status !== 'cancelled' && (
                    <Button asChild size="sm" variant="ghost"><Link href={`/print/trip/${trip.id}?shipment=${s.id}`} target="_blank"><Printer className="mr-1 h-4 w-4" />Печат</Link></Button>
                  )}
                </span>
              </header>
              <div className="px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-4">
                {s.packer && <span>Опаковал: {s.packer}{s.packed_at ? `, ${sofiaDateTime(s.packed_at)}` : ''}</span>}
                {s.sender && <span>Шофьор: {s.sender}{s.sent_at ? `, ${sofiaDateTime(s.sent_at)}` : ''}</span>}
                {s.receiver && <span>Приел: {s.receiver}{s.received_at ? `, ${sofiaDateTime(s.received_at)}` : ''}</span>}
              </div>
              {s.lines.length > 0 && (
                <table className="w-full text-sm">
                  <tbody>
                    {s.lines.map(l => (
                      <tr key={l.id} className="border-t">
                        <td className="px-4 py-1.5">{l.product_name}</td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                          {l.delivery_id ? <Link href={`/deliveries/${l.delivery_id}`} className="hover:underline">{formatDeliveryNumber(l.delivery_number)}</Link> : ''}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {l.qty} бр.
                          {l.received_qty != null && l.received_qty < l.qty && <span className="ml-1 text-red-700">(приети {l.received_qty})</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
      </div>

      {sendOpen && <SendDialog trip={trip} drivers={drivers} boxes={boxes} units={units} onClose={() => setSendOpen(false)} />}
      {cancelOpen && <CancelTripDialog tripId={trip.id} number={trip.number} onClose={() => setCancelOpen(false)} />}
    </div>
  )
}

function SendDialog({ trip, drivers, boxes, units, onClose }: {
  trip: TripDetail
  drivers: DriverOption[]
  boxes: number
  units: number
  onClose: () => void
}) {
  const router = useRouter()
  const now = useNow()
  const [driver, setDriver] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const stores = trip.shipments.filter(s => s.status !== 'cancelled').map(s => s.store_name)
  const driverName = drivers.find(d => d.id === driver)?.name ?? ''

  async function send() {
    setBusy(true)
    setError('')
    try {
      await postJson(`/api/deliveries/trips/${trip.id}/send`, { driver_id: driver, password }, 'Курсът не тръгна')
      onClose()
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Подпис на шофьора</DialogTitle></DialogHeader>
        <p className="text-sm">
          С подписа си шофьорът казва: „Взех {boxesText(boxes)} за {stores.join(', ')}.“
        </p>
        <p className="text-xs text-muted-foreground">
          {units} бр. излизат от Офис и влизат в магазините веднага. Продават се оттам, преди продавачът да е отметнал пратката.
        </p>
        <label className="block text-sm space-y-1">
          <span>Шофьор</span>
          <select className="h-10 w-full rounded-md border border-input bg-white px-2 text-sm" value={driver} onChange={e => setDriver(e.target.value)} aria-label="Шофьор">
            <option value="">Изберете…</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="block text-sm space-y-1">
          <span>Паролата на шофьора (пише я самият той)</span>
          <Input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} aria-label="Парола на шофьора" />
        </label>
        {driverName && <p className="text-sm text-muted-foreground">{driverName} · {sofiaDateTime(now)}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Назад</Button>
          <Button onClick={send} disabled={!driver || !password || busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}Подписвам и тръгвам
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CancelTripDialog({ tripId, number, onClose }: { tripId: string; number: number; onClose: () => void }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      await postJson(`/api/deliveries/trips/${tripId}/cancel`, { reason }, 'Курсът не беше отказан')
      onClose()
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Откажи курс {formatTripNumber(number)}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Пратките се махат, а готовата стока остава в Офис за следващ курс. Наличността не се променя. Курсът остава в списъка като „Отказан“.
        </p>
        <label className="block text-sm space-y-1">
          <span>Причина</span>
          <Input value={reason} onChange={e => setReason(e.target.value)} autoFocus aria-label="Причина" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Назад</Button>
          <Button variant="destructive" onClick={submit} disabled={reason.trim().length < 3 || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Откажи курса
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
