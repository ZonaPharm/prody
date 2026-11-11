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

/** One delivery line as "Етикетиране" reads it. */
export type LabelItemRow = {
  item_id: string
  delivery_id: string
  delivery_number: number | null
  sort_order: number
  product_id: string
  product_name: string
  product_sku: string | null
  product_price: number | null
  needs_label: boolean
  image: string | null
  received_qty: number
  labelled_qty: number
  plan: { store_id: string; planned_qty: number; ready_qty: number }[]
}

export type LabelItem = LabelItemRow & {
  /** received − labelled: what a tick labels now. */
  expected: number
  /** Where the units of this tick go: stores of the plan still short of ready units (store-name order), then Офис. */
  split: { store_id: string | null; qty: number }[]
}

/**
 * Where `units` newly labelled units of a line go, the same way _auto_ready_item gives
 * them out: labelled units that no store has yet first, then the stores still short of
 * ready units in store-name order; the rest stay in Офис (store_id null).
 */
export function labelSplit(
  item: Pick<LabelItemRow, 'labelled_qty' | 'plan'>,
  units: number,
  storeName: (id: string) => string,
): { store_id: string | null; qty: number }[] {
  const ready = item.plan.reduce((s, p) => s + p.ready_qty, 0)
  let waiting = Math.max(0, item.labelled_qty - ready)
  let left = units
  const out: { store_id: string | null; qty: number }[] = []
  const rows = [...item.plan].sort((a, b) => storeName(a.store_id).localeCompare(storeName(b.store_id), 'bg'))
  for (const p of rows) {
    let need = Math.max(0, p.planned_qty - p.ready_qty)
    const old = Math.min(need, waiting)
    waiting -= old
    need -= old
    const add = Math.min(need, left)
    if (add > 0) {
      out.push({ store_id: p.store_id, qty: add })
      left -= add
    }
  }
  if (left > 0) out.push({ store_id: null, qty: left })
  return out
}

/**
 * "Етикетиране": every received unit waits for a label, whatever store it goes to;
 * also those that stay in Офис (Офис sells online too). One row per delivery line with
 * received − labelled > 0, ordered by delivery and line.
 */
export function labelItems(rows: LabelItemRow[], storeName: (id: string) => string): LabelItem[] {
  return rows
    .map(r => {
      const expected = Math.max(0, r.received_qty - r.labelled_qty)
      return { ...r, expected, split: labelSplit(r, expected, storeName) }
    })
    .filter(r => r.expected > 0)
    .sort((a, b) =>
      (a.delivery_number ?? 0) - (b.delivery_number ?? 0) ||
      a.sort_order - b.sort_order ||
      a.item_id.localeCompare(b.item_id),
    )
}

/** "Ботев 10 · Офис 10" */
export function splitText(split: { store_id: string | null; qty: number }[], storeName: (id: string) => string): string {
  return split.map(s => `${s.store_id ? storeName(s.store_id) : 'Офис'} ${s.qty}`).join(' · ')
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
 * What a delivery still needs after receiving, for the buttons on its page: received
 * units without a label (→ "Етикетиране", also those staying in Офис) and units ready
 * for a store but not yet sent (→ "Курсове").
 */
export function deliveryNextSteps(items: {
  received_qty: number
  labelled_qty: number
  plan: { planned_qty: number; ready_qty: number; shipped_qty: number }[]
}[]): { toLabel: number; toShip: number } {
  let toLabel = 0
  let toShip = 0
  for (const i of items) {
    toLabel += Math.max(0, i.received_qty - i.labelled_qty)
    toShip += i.plan.reduce((s, p) => s + Math.max(0, p.ready_qty - p.shipped_qty), 0)
  }
  return { toLabel, toShip }
}
