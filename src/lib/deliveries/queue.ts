/**
 * What waits for work across every open delivery, computed from the plan rows
 * as they stand. Pure functions; work.ts reads the rows.
 */

export type QueuePlanRow = {
  plan_id: string
  store_id: string
  planned_qty: number
  ready_qty: number
  shipped_qty: number
  item_id: string
  received_qty: number
  sort_order: number
  delivery_id: string
  delivery_number: number | null
  product_id: string
  product_name: string
  product_sku: string | null
  product_price: number | null
  needs_label: boolean
  image: string | null
}

export type LabelQueueRow = QueuePlanRow & {
  /** planned − ready: what this store still needs ready. */
  open: number
  /** received − Σ ready over the item: units in Офис not yet labelled for anyone. */
  item_free: number
  /** What a tick makes ready: min(open, item_free). */
  expected: number
}

/**
 * "Етикетиране": plan rows that still need ready units and whose product has
 * received units nobody has labelled yet. Ordered by delivery, line, store
 * name (given), so one product's stores sit together.
 */
export function labelQueue(rows: QueuePlanRow[], storeName: (id: string) => string): LabelQueueRow[] {
  const readyByItem = new Map<string, number>()
  for (const r of rows) readyByItem.set(r.item_id, (readyByItem.get(r.item_id) ?? 0) + r.ready_qty)

  return rows
    .map(r => {
      const open = Math.max(0, r.planned_qty - r.ready_qty)
      const item_free = Math.max(0, r.received_qty - (readyByItem.get(r.item_id) ?? 0))
      return { ...r, open, item_free, expected: Math.min(open, item_free) }
    })
    .filter(r => r.expected > 0)
    .sort((a, b) =>
      (a.delivery_number ?? 0) - (b.delivery_number ?? 0) ||
      a.sort_order - b.sort_order ||
      a.item_id.localeCompare(b.item_id) ||
      storeName(a.store_id).localeCompare(storeName(b.store_id), 'bg'),
    )
}

export type UnsentLine = { plan_id: string; qty: number }

export type StoreReady = {
  store_id: string
  rows: number
  units: number
  deliveries: number
}

/**
 * Per store, what a new trip would take now: ready − shipped − already on a
 * trip that has not left. The same rule as create_trip, so the card matches
 * what the trip will hold.
 */
export function readyByStore(rows: QueuePlanRow[], unsent: UnsentLine[]): StoreReady[] {
  const onTrips = new Map<string, number>()
  for (const l of unsent) onTrips.set(l.plan_id, (onTrips.get(l.plan_id) ?? 0) + l.qty)

  const byStore = new Map<string, { rows: number; units: number; deliveries: Set<string> }>()
  for (const r of rows) {
    const qty = r.ready_qty - r.shipped_qty - (onTrips.get(r.plan_id) ?? 0)
    if (qty <= 0) continue
    const s = byStore.get(r.store_id) ?? { rows: 0, units: 0, deliveries: new Set<string>() }
    s.rows += 1
    s.units += qty
    s.deliveries.add(r.delivery_id)
    byStore.set(r.store_id, s)
  }
  return [...byStore.entries()].map(([store_id, s]) => ({ store_id, rows: s.rows, units: s.units, deliveries: s.deliveries.size }))
}

/** "готови 5 реда, 86 бр., от 5 доставки" */
export function storeReadyText(s: Pick<StoreReady, 'rows' | 'units' | 'deliveries'>): string {
  const rows = s.rows === 1 ? '1 ред' : `${s.rows} реда`
  const dels = s.deliveries === 1 ? '1 доставка' : `${s.deliveries} доставки`
  return `готови ${rows}, ${s.units} бр., от ${dels}`
}

/** How long a sent shipment has waited for the store, in whole days (0 = today). */
export function daysWaiting(sentAt: string | null, now: Date = new Date()): number {
  if (!sentAt) return 0
  return Math.max(0, Math.floor((now.getTime() - new Date(sentAt).getTime()) / 86_400_000))
}

/**
 * What a delivery that is in work still needs after receiving, for the buttons on its page:
 * units received but not yet ready (→ "Етикетиране") and units ready but not yet sent (→ "Курсове").
 * "To label" is capped per line by both the plan and what arrived.
 */
export function deliveryNextSteps(items: {
  received_qty: number
  plan: { planned_qty: number; ready_qty: number; shipped_qty: number }[]
}[]): { toLabel: number; toShip: number } {
  let toLabel = 0
  let toShip = 0
  for (const i of items) {
    const ready = i.plan.reduce((s, p) => s + p.ready_qty, 0)
    const planLeft = i.plan.reduce((s, p) => s + Math.max(0, p.planned_qty - p.ready_qty), 0)
    toLabel += Math.max(0, Math.min(planLeft, i.received_qty - ready))
    toShip += i.plan.reduce((s, p) => s + Math.max(0, p.ready_qty - p.shipped_qty), 0)
  }
  return { toLabel, toShip }
}
