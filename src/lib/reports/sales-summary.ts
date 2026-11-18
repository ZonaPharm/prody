/**
 * Sales figures for the admin Отчети page, computed from plain rows so the
 * arithmetic can be tested without a database.
 *
 * Two things the old page got wrong are settled here:
 *  - A receipt is a sale_group_id (one press of „Плати“), not a sales row. The
 *    page used to count rows, so a receipt with three products counted as three
 *    sales and the average receipt came out a third of its real size.
 *  - Profit uses the purchase price of the batch each unit actually left
 *    (the 'sell' stock movements written by sell_from_batches). Where a sale has
 *    no such movement — older sales, and a stretch when movements were not
 *    written — the product's catalogue cost_price stands in. Where neither is
 *    known the line is left out of profit, and `costCoverage` says how much of
 *    the revenue the profit figure covers.
 */

export type SaleRow = {
  id: string
  sale_group_id: string | null
  store_id: string
  store_name: string
  product_id: string
  product_name: string
  quantity: number
  sale_price: number | string
  payment_method: string | null
  sale_date: string
  /** products.cost_price, the fallback when no batch cost was recorded. */
  cost_price: number | string | null
}

/** A 'sell' stock movement: quantity is negative (units taken out). */
export type SellMovement = {
  sale_id: string
  quantity: number
  unit_cost: number | string | null
}

export type Totals = {
  revenue: number
  receipts: number
  units: number
  avgReceipt: number
  /** Revenue of the lines whose purchase price is known. */
  revenueWithCost: number
  cost: number
  profit: number
  /** profit / revenueWithCost, in percent; null when nothing has a cost. */
  marginPct: number | null
  /** revenueWithCost / revenue, in percent; null when there is no revenue. */
  costCoverage: number | null
}

export type PaymentTotals = { cash: number; card: number; other: number }

export type StoreTotals = Totals & {
  store_id: string
  store_name: string
  payment: PaymentTotals
}

export type ProductTotals = {
  product_id: string
  name: string
  units: number
  revenue: number
  profit: number | null
  marginPct: number | null
}

export type SalesSummary = {
  totals: Totals
  payment: PaymentTotals
  byStore: StoreTotals[]
  byDay: { sale_date: string; revenue: number; profit: number }[]
  topByProfit: ProductTotals[]
  uniqueProducts: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

type Acc = {
  revenue: number
  receipts: Set<string>
  units: number
  revenueWithCost: number
  cost: number
}

const newAcc = (): Acc => ({ revenue: 0, receipts: new Set(), units: 0, revenueWithCost: 0, cost: 0 })

function finish(a: Acc): Totals {
  const receipts = a.receipts.size
  const profit = a.revenueWithCost - a.cost
  return {
    revenue: round2(a.revenue),
    receipts,
    units: a.units,
    avgReceipt: receipts > 0 ? round2(a.revenue / receipts) : 0,
    revenueWithCost: round2(a.revenueWithCost),
    cost: round2(a.cost),
    profit: round2(profit),
    marginPct: pct(profit, a.revenueWithCost),
    costCoverage: pct(a.revenueWithCost, a.revenue),
  }
}

const positive = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Purchase cost of one sales row, or null when it cannot be known.
 * Each unit is priced at its batch's unit_cost; a batch price of 0 (units added
 * by an inventory correction) and units without a movement take the catalogue
 * cost_price, the same rule as „Стоката в пари“.
 */
export function lineCost(sale: SaleRow, movements: SellMovement[]): number | null {
  const fallback = positive(sale.cost_price)
  let cost = 0
  let covered = 0
  for (const m of movements) {
    const units = Math.abs(m.quantity)
    const c = positive(m.unit_cost) ?? fallback
    if (c == null) return null
    cost += units * c
    covered += units
  }
  const rest = sale.quantity - covered
  if (rest > 0) {
    if (fallback == null) return null
    cost += rest * fallback
  }
  return cost
}

/** Receipt key: the group of one checkout; rows from before groups stand alone. */
const receiptKey = (s: SaleRow) => s.sale_group_id || s.id

export function summarizeSales(sales: SaleRow[], movements: SellMovement[]): SalesSummary {
  const movementsBySale = new Map<string, SellMovement[]>()
  for (const m of movements) {
    const list = movementsBySale.get(m.sale_id)
    if (list) list.push(m)
    else movementsBySale.set(m.sale_id, [m])
  }

  const total = newAcc()
  const payment: PaymentTotals = { cash: 0, card: 0, other: 0 }
  const stores = new Map<string, { name: string; acc: Acc; payment: PaymentTotals }>()
  const days = new Map<string, { revenue: number; profit: number }>()
  const products = new Map<string, { name: string; units: number; revenue: number; revenueWithCost: number; cost: number }>()

  for (const s of sales) {
    const revenue = s.quantity * Number(s.sale_price)
    const cost = lineCost(s, movementsBySale.get(s.id) || [])
    const key = receiptKey(s)

    let store = stores.get(s.store_id)
    if (!store) {
      store = { name: s.store_name, acc: newAcc(), payment: { cash: 0, card: 0, other: 0 } }
      stores.set(s.store_id, store)
    }

    for (const acc of [total, store.acc]) {
      acc.revenue += revenue
      acc.receipts.add(key)
      acc.units += s.quantity
      if (cost != null) {
        acc.revenueWithCost += revenue
        acc.cost += cost
      }
    }

    const method = s.payment_method === 'card' ? 'card' : (s.payment_method === 'cash' || s.payment_method == null) ? 'cash' : 'other'
    payment[method] += revenue
    store.payment[method] += revenue

    const day = days.get(s.sale_date) || { revenue: 0, profit: 0 }
    day.revenue += revenue
    if (cost != null) day.profit += revenue - cost
    days.set(s.sale_date, day)

    const p = products.get(s.product_id) || { name: s.product_name, units: 0, revenue: 0, revenueWithCost: 0, cost: 0 }
    p.units += s.quantity
    p.revenue += revenue
    if (cost != null) {
      p.revenueWithCost += revenue
      p.cost += cost
    }
    products.set(s.product_id, p)
  }

  const roundPayment = (p: PaymentTotals): PaymentTotals => ({ cash: round2(p.cash), card: round2(p.card), other: round2(p.other) })

  const byStore: StoreTotals[] = Array.from(stores.entries())
    .map(([store_id, s]) => ({ store_id, store_name: s.name, ...finish(s.acc), payment: roundPayment(s.payment) }))
    .sort((a, b) => b.revenue - a.revenue || a.store_name.localeCompare(b.store_name, 'bg'))

  const byDay = Array.from(days.entries())
    .map(([sale_date, d]) => ({ sale_date, revenue: round2(d.revenue), profit: round2(d.profit) }))
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date))

  const topByProfit: ProductTotals[] = Array.from(products.entries())
    .map(([product_id, p]) => {
      const hasCost = p.revenueWithCost > 0
      const profit = hasCost ? round2(p.revenueWithCost - p.cost) : null
      return {
        product_id,
        name: p.name,
        units: p.units,
        revenue: round2(p.revenue),
        profit,
        marginPct: hasCost ? pct(p.revenueWithCost - p.cost, p.revenueWithCost) : null,
      }
    })
    .filter(p => p.profit != null)
    .sort((a, b) => (b.profit as number) - (a.profit as number) || a.name.localeCompare(b.name, 'bg'))
    .slice(0, 10)

  return {
    totals: finish(total),
    payment: roundPayment(payment),
    byStore,
    byDay,
    topByProfit,
    uniqueProducts: products.size,
  }
}

/**
 * The period of the same length that ends the day before `from`.
 * 1–30 November gives 2–31 October; a single day gives the day before.
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const day = 86400000
  const start = Date.parse(from + 'T00:00:00Z')
  const end = Date.parse(to + 'T00:00:00Z')
  const length = Math.max(0, Math.round((end - start) / day)) + 1
  const prevEnd = new Date(start - day)
  const prevStart = new Date(start - length * day)
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  return { from: ymd(prevStart), to: ymd(prevEnd) }
}

/** Percent change from `before` to `now`; null when there is nothing to compare with. */
export function changePct(now: number, before: number): number | null {
  if (!before) return null
  return Math.round(((now - before) / before) * 1000) / 10
}
