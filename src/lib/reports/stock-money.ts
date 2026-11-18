/**
 * „Стоката в пари“ on the admin Отчети page: how much money sits in stock in
 * each place, which stock has not sold for a long time, and what was written
 * off. Pure functions over plain rows, so the sums are tested without a
 * database (src/app/api/reports/stock-money/route.ts fetches the rows).
 *
 * Purchase price of a unit: the unit_cost of the batch it sits in. A batch
 * with unit_cost 0 or empty has no known price (an inventory correction that
 * added units creates such a batch), so the catalogue cost_price stands in;
 * when that is missing too, the units are counted but not valued, and the
 * page says how many units that is.
 */

export type StoreRow = { id: string; name: string; is_warehouse: boolean }

export type ProductRow = {
  id: string
  name: string
  price: number | string | null
  cost_price: number | string | null
}

export type BatchRow = {
  product_id: string
  store_id: string
  quantity_remaining: number
  unit_cost: number | string | null
  created_at: string
}

/** One sale row since the dead-stock cutoff (voided sales left out). */
export type RecentSale = { product_id: string; store_id: string }

export type CorrectionRow = {
  id: string
  product_id: string
  store_id: string
  difference: number
  reason: string
  created_at: string
  notes: string | null
  /** unit_cost of the correction's stock movement, if any. */
  movement_unit_cost: number | string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

const positive = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Purchase price of one unit, or null when it is not known. */
export function unitCost(batchCost: number | string | null, product: ProductRow | undefined): number | null {
  return positive(batchCost) ?? positive(product?.cost_price)
}

// ─── Stock value ────────────────────────────────────────────────────────────

export type StoreValue = {
  store_id: string
  store_name: string
  is_warehouse: boolean
  units: number
  products: number
  /** At purchase price, for the units whose price is known. */
  cost: number
  /** At the catalogue selling price, for the units that have one. */
  retail: number
  unitsWithoutCost: number
  unitsWithoutPrice: number
}

export type StockValue = { stores: StoreValue[]; total: Omit<StoreValue, 'store_id' | 'store_name' | 'is_warehouse'> }

export function stockValue(batches: BatchRow[], products: ProductRow[], stores: StoreRow[]): StockValue {
  const productById = new Map(products.map(p => [p.id, p]))
  const acc = new Map<string, StoreValue & { productSet: Set<string> }>()
  for (const s of stores) {
    acc.set(s.id, {
      store_id: s.id, store_name: s.name, is_warehouse: s.is_warehouse,
      units: 0, products: 0, cost: 0, retail: 0, unitsWithoutCost: 0, unitsWithoutPrice: 0,
      productSet: new Set(),
    })
  }
  const totalProducts = new Set<string>()
  const total = { units: 0, products: 0, cost: 0, retail: 0, unitsWithoutCost: 0, unitsWithoutPrice: 0 }

  for (const b of batches) {
    const qty = b.quantity_remaining
    if (!(qty > 0)) continue
    const s = acc.get(b.store_id)
    if (!s) continue // a store that is no longer active
    const product = productById.get(b.product_id)
    const cost = unitCost(b.unit_cost, product)
    const price = positive(product?.price)

    for (const t of [s, total]) {
      t.units += qty
      if (cost != null) t.cost += qty * cost
      else t.unitsWithoutCost += qty
      if (price != null) t.retail += qty * price
      else t.unitsWithoutPrice += qty
    }
    s.productSet.add(b.product_id)
    totalProducts.add(b.product_id)
  }

  const out: StoreValue[] = Array.from(acc.values()).map(({ productSet, ...s }) => ({
    ...s, products: productSet.size, cost: round2(s.cost), retail: round2(s.retail),
  }))
  // Офис first, it is where stock comes in; then the stores by money held.
  out.sort((a, b) => Number(b.is_warehouse) - Number(a.is_warehouse) || b.cost - a.cost || a.store_name.localeCompare(b.store_name, 'bg'))

  return {
    stores: out,
    total: { ...total, products: totalProducts.size, cost: round2(total.cost), retail: round2(total.retail) },
  }
}

// ─── Dead stock ─────────────────────────────────────────────────────────────

export type DeadRow = {
  product_id: string
  product_name: string
  store_id: string
  store_name: string
  is_warehouse: boolean
  /** Units that have been in this place since before the cutoff. */
  units: number
  cost: number | null
  retail: number | null
  /** When the oldest of those units came to this place. */
  since: string
}

export type DeadStock = {
  rows: DeadRow[]
  byStore: { store_id: string; store_name: string; is_warehouse: boolean; units: number; cost: number; lines: number }[]
  total: { units: number; cost: number; lines: number; unitsWithoutCost: number }
}

/**
 * Stock that has been in a place since before `cutoffIso` and has not sold
 * since then. In a store, "not sold" means not sold in that store. Офис does
 * not sell, so there it means not sold in any store.
 *
 * Units that arrived after the cutoff are not counted: a product delivered
 * last week is not dead just because it had no time to sell.
 */
export function deadStock(
  batches: BatchRow[],
  products: ProductRow[],
  stores: StoreRow[],
  recentSales: RecentSale[],
  cutoffIso: string,
): DeadStock {
  const productById = new Map(products.map(p => [p.id, p]))
  const storeById = new Map(stores.map(s => [s.id, s]))
  const soldInStore = new Set(recentSales.map(s => `${s.product_id}|${s.store_id}`))
  const soldAnywhere = new Set(recentSales.map(s => s.product_id))
  const cutoff = Date.parse(cutoffIso)

  const rows = new Map<string, DeadRow & { costKnown: boolean; retailKnown: boolean; unknownUnits: number }>()
  for (const b of batches) {
    if (!(b.quantity_remaining > 0)) continue
    if (!(Date.parse(b.created_at) < cutoff)) continue
    const store = storeById.get(b.store_id)
    if (!store) continue
    const sold = store.is_warehouse ? soldAnywhere.has(b.product_id) : soldInStore.has(`${b.product_id}|${b.store_id}`)
    if (sold) continue

    const key = `${b.product_id}|${b.store_id}`
    const product = productById.get(b.product_id)
    let row = rows.get(key)
    if (!row) {
      row = {
        product_id: b.product_id, product_name: product?.name || '—',
        store_id: store.id, store_name: store.name, is_warehouse: store.is_warehouse,
        units: 0, cost: 0, retail: 0, since: b.created_at,
        costKnown: false, retailKnown: false, unknownUnits: 0,
      }
      rows.set(key, row)
    }
    const qty = b.quantity_remaining
    row.units += qty
    const cost = unitCost(b.unit_cost, product)
    if (cost != null) { row.cost = (row.cost as number) + qty * cost; row.costKnown = true }
    else row.unknownUnits += qty
    const price = positive(product?.price)
    if (price != null) { row.retail = (row.retail as number) + qty * price; row.retailKnown = true }
    if (b.created_at < row.since) row.since = b.created_at
  }

  const list: DeadRow[] = []
  const byStore = new Map<string, DeadStock['byStore'][number]>()
  const total = { units: 0, cost: 0, lines: 0, unitsWithoutCost: 0 }
  for (const r of rows.values()) {
    const { costKnown, retailKnown, unknownUnits, ...row } = r
    const out: DeadRow = {
      ...row,
      cost: costKnown ? round2(row.cost as number) : null,
      retail: retailKnown ? round2(row.retail as number) : null,
    }
    list.push(out)
    const s = byStore.get(row.store_id) || { store_id: row.store_id, store_name: row.store_name, is_warehouse: row.is_warehouse, units: 0, cost: 0, lines: 0 }
    s.units += row.units
    s.cost += out.cost ?? 0
    s.lines++
    byStore.set(row.store_id, s)
    total.units += row.units
    total.cost += out.cost ?? 0
    total.lines++
    total.unitsWithoutCost += unknownUnits
  }

  list.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.since.localeCompare(b.since) || a.product_name.localeCompare(b.product_name, 'bg'))
  const storesOut = Array.from(byStore.values())
    .map(s => ({ ...s, cost: round2(s.cost) }))
    .sort((a, b) => b.cost - a.cost || a.store_name.localeCompare(b.store_name, 'bg'))

  return { rows: list, byStore: storesOut, total: { ...total, cost: round2(total.cost) } }
}

// ─── Write-offs ─────────────────────────────────────────────────────────────

export const REASON_LABELS: Record<string, string> = {
  damaged: 'Повредени',
  expired: 'Изтекъл срок',
  inventory_count: 'При инвентаризация',
  wrong_entry: 'Грешно въвеждане',
  other: 'Друго',
}

const REASON_ORDER = ['damaged', 'expired', 'inventory_count', 'other', 'wrong_entry']

/**
 * „Грешно въвеждане“ fixes a typing mistake; no stock was lost or found, so it
 * is listed but left out of the totals and the per-store sums.
 */
export const NOT_A_LOSS = new Set(['wrong_entry'])

export type ReasonTotals = {
  reason: string
  label: string
  units: number
  value: number
  unitsWithoutCost: number
  count: number
  /** false for „Грешно въвеждане“: shown, but not in the totals. */
  counted: boolean
}

export type WriteOffRow = {
  id: string
  created_at: string
  product_name: string
  store_name: string
  reason: string
  label: string
  difference: number
  value: number | null
  notes: string | null
}

export type WriteOffs = {
  /** Units that went missing or were thrown away (difference < 0). */
  losses: ReasonTotals[]
  /** Units found that the system did not have (difference > 0). */
  surplus: ReasonTotals[]
  lossTotal: { units: number; value: number; unitsWithoutCost: number }
  surplusTotal: { units: number; value: number; unitsWithoutCost: number }
  byStore: { store_id: string; store_name: string; lossUnits: number; lossValue: number; surplusUnits: number; surplusValue: number }[]
  rows: WriteOffRow[]
}

export function writeOffs(corrections: CorrectionRow[], products: ProductRow[], stores: StoreRow[]): WriteOffs {
  const productById = new Map(products.map(p => [p.id, p]))
  const storeName = new Map(stores.map(s => [s.id, s.name]))
  const losses = new Map<string, ReasonTotals>()
  const surplus = new Map<string, ReasonTotals>()
  const byStore = new Map<string, WriteOffs['byStore'][number]>()
  const lossTotal = { units: 0, value: 0, unitsWithoutCost: 0 }
  const surplusTotal = { units: 0, value: 0, unitsWithoutCost: 0 }
  const rows: WriteOffRow[] = []

  for (const c of corrections) {
    if (!c.difference) continue
    const product = productById.get(c.product_id)
    const cost = unitCost(c.movement_unit_cost, product)
    const units = Math.abs(c.difference)
    const value = cost != null ? units * cost : null
    const label = REASON_LABELS[c.reason] || c.reason

    const isLoss = c.difference < 0
    const groups = isLoss ? losses : surplus
    const counted = !NOT_A_LOSS.has(c.reason)
    const g = groups.get(c.reason) || { reason: c.reason, label, units: 0, value: 0, unitsWithoutCost: 0, count: 0, counted }
    g.units += units
    g.count++
    if (value != null) g.value += value
    else g.unitsWithoutCost += units
    groups.set(c.reason, g)

    const name = storeName.get(c.store_id) || '—'
    if (counted) {
      const t = isLoss ? lossTotal : surplusTotal
      t.units += units
      if (value != null) t.value += value
      else t.unitsWithoutCost += units

      const s = byStore.get(c.store_id) || { store_id: c.store_id, store_name: name, lossUnits: 0, lossValue: 0, surplusUnits: 0, surplusValue: 0 }
      if (isLoss) { s.lossUnits += units; s.lossValue += value ?? 0 }
      else { s.surplusUnits += units; s.surplusValue += value ?? 0 }
      byStore.set(c.store_id, s)
    }

    rows.push({
      id: c.id, created_at: c.created_at, product_name: product?.name || '—', store_name: name,
      reason: c.reason, label, difference: c.difference,
      value: value != null ? round2(value) : null, notes: c.notes,
    })
  }

  const order = (a: ReasonTotals, b: ReasonTotals) => {
    const ia = REASON_ORDER.indexOf(a.reason), ib = REASON_ORDER.indexOf(b.reason)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  }
  const fin = (m: Map<string, ReasonTotals>) => Array.from(m.values()).map(g => ({ ...g, value: round2(g.value) })).sort(order)

  rows.sort((a, b) => b.created_at.localeCompare(a.created_at))

  return {
    losses: fin(losses),
    surplus: fin(surplus),
    lossTotal: { ...lossTotal, value: round2(lossTotal.value) },
    surplusTotal: { ...surplusTotal, value: round2(surplusTotal.value) },
    byStore: Array.from(byStore.values())
      .map(s => ({ ...s, lossValue: round2(s.lossValue), surplusValue: round2(s.surplusValue) }))
      .sort((a, b) => b.lossValue - a.lossValue || a.store_name.localeCompare(b.store_name, 'bg')),
    rows,
  }
}
