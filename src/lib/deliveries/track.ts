import type { ShipmentStatus } from './work'

/**
 * "Къде е стоката сега": every unit of a delivery line is in exactly one stage,
 * read from the counters the database keeps (received, labelled, ready, shipped)
 * and the shipment lines. Pure, so the delivery page and the product page draw
 * the same thing.
 *
 *   quantity = не е получено + чака етикет + в Офис с етикет
 *            + Σ по магазин (чака курс + в курс + на път + приети)
 *
 * Units that wait for a label are not yet anyone's: the label signature gives them
 * to the stores of the plan, then the rest stays in Офис. `forStores` says how many
 * of them the stores still wait for.
 */

export type Stage = 'not_received' | 'to_label' | 'office' | 'to_trip' | 'on_trip' | 'on_way' | 'accepted'

export const STAGE_ORDER: Stage[] = ['not_received', 'to_label', 'office', 'to_trip', 'on_trip', 'on_way', 'accepted']

export const STAGE_LABEL: Record<Stage, string> = {
  not_received: 'Не е получено',
  to_label: 'Чака етикет',
  office: 'В Офис, с етикет',
  to_trip: 'Готово, чака курс',
  on_trip: 'В курс, чака тръгване',
  on_way: 'На път',
  accepted: 'Прието в магазина',
}

/** Bar colour per stage, from "not yet" (grey) to "done" (green). */
export const STAGE_TONE: Record<Stage, { bar: string; dot: string; text: string }> = {
  not_received: { bar: 'bg-slate-200', dot: 'bg-slate-300', text: 'text-slate-600' },
  to_label: { bar: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-800' },
  office: { bar: 'bg-slate-500', dot: 'bg-slate-500', text: 'text-slate-700' },
  to_trip: { bar: 'bg-sky-500', dot: 'bg-sky-500', text: 'text-sky-800' },
  on_trip: { bar: 'bg-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-800' },
  on_way: { bar: 'bg-violet-500', dot: 'bg-violet-500', text: 'text-violet-800' },
  accepted: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-800' },
}

export type TrackLine = {
  plan_id: string
  qty: number
  received_qty: number | null
  shipment_id: string
  shipment_number: number | null
  shipment_status: ShipmentStatus
  trip_id: string
  trip_number: number | null
}

export type TrackItem = {
  quantity: number
  received_qty: number
  labelled_qty: number
  plan: { id: string; store_id: string; planned_qty: number; ready_qty: number; shipped_qty: number }[]
}

/** One row of "where it is": a stage, how many, for which store, and on which trip. */
export type WherePart = {
  stage: Stage
  qty: number
  /** null = Офис or not anyone's yet. */
  store_id: string | null
  trip_id?: string
  trip_number?: number | null
  shipment_number?: number | null
  /** Accepted lines only: how many the store counted less than were sent. */
  missing?: number
  /** On a trip: the shipment is packed and waits only for the driver. */
  packed?: boolean
}

export type Whereabouts = {
  parts: WherePart[]
  /** Units per stage, for the bar. */
  totals: Record<Stage, number>
  /** Of the units waiting for a label or still to be received: how many each store still waits for. */
  forStores: { store_id: string; qty: number }[]
}

const ACCEPTED: ShipmentStatus[] = ['received', 'received_with_issues']

export function whereabouts(item: TrackItem, lines: TrackLine[]): Whereabouts {
  const parts: WherePart[] = []
  const add = (p: WherePart) => { if (p.qty > 0) parts.push(p) }

  const ready = item.plan.reduce((s, p) => s + p.ready_qty, 0)
  add({ stage: 'not_received', qty: Math.max(0, item.quantity - item.received_qty), store_id: null })
  add({ stage: 'to_label', qty: Math.max(0, item.received_qty - item.labelled_qty), store_id: null })
  add({ stage: 'office', qty: Math.max(0, item.labelled_qty - ready), store_id: null })

  const live = lines.filter(l => l.shipment_status !== 'cancelled')
  for (const p of item.plan) {
    const mine = live.filter(l => l.plan_id === p.id)
    const onTrip = mine.filter(l => l.shipment_status === 'packing' || l.shipment_status === 'packed')
    const onTripQty = onTrip.reduce((s, l) => s + l.qty, 0)
    add({ stage: 'to_trip', qty: Math.max(0, p.ready_qty - p.shipped_qty - onTripQty), store_id: p.store_id })
    for (const l of onTrip) {
      add({ stage: 'on_trip', qty: l.qty, store_id: p.store_id, trip_id: l.trip_id, trip_number: l.trip_number, shipment_number: l.shipment_number, packed: l.shipment_status === 'packed' })
    }
    for (const l of mine.filter(l => l.shipment_status === 'sent')) {
      add({ stage: 'on_way', qty: l.qty, store_id: p.store_id, trip_id: l.trip_id, trip_number: l.trip_number, shipment_number: l.shipment_number })
    }
    for (const l of mine.filter(l => ACCEPTED.includes(l.shipment_status))) {
      const missing = Math.max(0, l.qty - (l.received_qty ?? l.qty))
      add({ stage: 'accepted', qty: l.qty, store_id: p.store_id, trip_id: l.trip_id, trip_number: l.trip_number, shipment_number: l.shipment_number, missing: missing || undefined })
    }
  }

  const totals = Object.fromEntries(STAGE_ORDER.map(s => [s, 0])) as Record<Stage, number>
  for (const p of parts) totals[p.stage] += p.qty

  const forStores = item.plan
    .map(p => ({ store_id: p.store_id, qty: Math.max(0, p.planned_qty - p.ready_qty) }))
    .filter(s => s.qty > 0)

  return { parts, totals, forStores }
}

/** The one line a busy person reads: where most of it is now, and what it waits for. */
export function whereSummary(w: Whereabouts): string {
  const t = w.totals
  const total = STAGE_ORDER.reduce((s, k) => s + t[k], 0)
  if (total === 0) return '—'
  if (t.accepted === total) return 'Всичко е прието в магазините'
  if (t.accepted + t.office === total) return t.office === total ? 'Всичко е в Офис, с етикет' : 'Готово: приетото е в магазините, останалото е в Офис'
  const waiting: string[] = []
  if (t.not_received) waiting.push(`получаване ${t.not_received} бр.`)
  if (t.to_label) waiting.push(`етикет ${t.to_label} бр.`)
  if (t.to_trip) waiting.push(`курс ${t.to_trip} бр.`)
  if (t.on_trip) waiting.push(`шофьор ${t.on_trip} бр.`)
  if (t.on_way) waiting.push(`приемане в магазина ${t.on_way} бр.`)
  return `Чакат: ${waiting.join(', ')}`
}
