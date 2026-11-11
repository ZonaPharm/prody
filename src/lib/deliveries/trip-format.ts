import type { ShipmentStatus, TripStatus } from './work'

/** How trips (К-…) and shipments (П-…) read on screen. */

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  open: 'Събира се',
  departed: 'Тръгнал',
  completed: 'Завършен',
  cancelled: 'Отказан',
}

export const TRIP_STATUS_TONE: Record<TripStatus, string> = {
  open: 'bg-amber-50 text-amber-800 border-amber-200',
  departed: 'bg-blue-50 text-blue-800 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
}

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  packing: 'Събира се',
  packed: 'Опакована',
  sent: 'На път',
  received: 'Приета',
  received_with_issues: 'Приета с проблем',
  cancelled: 'Отказана',
}

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, string> = {
  packing: 'bg-amber-50 text-amber-800 border-amber-200',
  packed: 'bg-sky-50 text-sky-800 border-sky-200',
  sent: 'bg-blue-50 text-blue-800 border-blue-200',
  received: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  received_with_issues: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
}

/** The trip can leave when it has shipments and every one is packed. */
export function tripReadyToSend(shipments: { status: ShipmentStatus }[]): boolean {
  const live = shipments.filter(s => s.status !== 'cancelled')
  return live.length > 0 && live.every(s => s.status === 'packed')
}

/** "2 кашона", "1 кашон" */
export function boxesText(n: number | null | undefined): string {
  if (!n) return ''
  return `${n} ${n === 1 ? 'кашон' : 'кашона'}`
}
