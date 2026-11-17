/**
 * Nightly data-integrity rules.
 *
 * Every rule here exists because its failure already happened once and went
 * unnoticed for weeks:
 *
 * - quantity_on_hand drifting from the batches: 2753 units across 153 products
 *   by August, and 402 across 48 more by October, found only when a user
 *   reported a product showing 10 of 5.
 * - sales recorded without a stock movement: 4546 of them, from a broken
 *   foreign key, before anyone looked.
 *
 * There was a fourth, store_filter_headroom: the catalogue's store filter put
 * every product id in the request URL and broke at 398 (Ботев reached 391).
 * The filter now joins in the database and has no such limit, so the check
 * went with it.
 *
 * Pure functions over plain rows — no database client, no mail — so they can
 * be tested against real data without side effects. The caller fetches and
 * notifies.
 */

export type IntegrityInput = {
  products: { id: string; name: string; status: string; quantity_on_hand: number | null }[]
  batches: { product_id: string; store_id: string; quantity_remaining: number }[]
  /** Sales old enough that their stock movement should already exist. */
  recentSales: { id: string }[]
  /** sale_id of every stock movement created over the same window. */
  movementSaleIds: string[]
  /**
   * The deliveries tables (20261110_deliveries_schema). Left out, the delivery
   * checks do not run; `{ unavailable }` says why they could not, and comes
   * back as a finding instead of failing the whole check.
   */
  deliveries?: DeliveriesInput | { unavailable: string; missingTables: boolean }
}

export type DeliveriesInput = {
  stores: { id: string; name: string; is_warehouse: boolean | null }[]
  deliveries: { id: string; number: number | null; status: string }[]
  items: { id: string; delivery_id: string; product_id: string; received_qty: number }[]
  plans: {
    id: string
    delivery_item_id: string
    store_id: string
    planned_qty: number
    ready_qty: number
    shipped_qty: number
  }[]
  /** Shipments in status 'sent' — the only ones the checks look at. */
  sentShipments: { id: string; number: number; store_id: string; sent_at: string | null }[]
  /** Time of the check, in ms. Passed in so the rules stay pure. */
  now: number
}

export type Severity = 'error' | 'warning'

export type Finding = {
  check: string
  severity: Severity
  title: string
  detail: string[]
}

export type IntegrityReport = {
  /** False when any finding is an error. Warnings alone keep it true. */
  ok: boolean
  findings: Finding[]
  stats: {
    products: number
    batches: number
    salesChecked: number
  }
}

const MAX_DETAIL_LINES = 10

export function evaluateIntegrity(input: IntegrityInput): IntegrityReport {
  const findings: Finding[] = [
    ...checkStockMatchesBatches(input),
    ...checkNoNegativeBatches(input),
    ...checkSalesHaveMovements(input),
    ...checkDeliveries(input),
  ]

  return {
    ok: !findings.some(f => f.severity === 'error'),
    findings,
    stats: {
      products: input.products.length,
      batches: input.batches.length,
      salesChecked: input.recentSales.length,
    },
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The block that goes into the daily backup email and the alert. */
export function integritySummaryHtml(report: IntegrityReport): string {
  if (report.findings.length === 0) {
    return `<p><strong>Проверка на данните:</strong> ✅ всичко съвпада
(${report.stats.products} продукта, ${report.stats.batches} партиди, ${report.stats.salesChecked} продажби за 7 дни).</p>`
  }

  const blocks = report.findings.map(f => {
    const mark = f.severity === 'error' ? '❌' : '⚠️'
    const lines = f.detail.map(d => `<li>${escapeHtml(d)}</li>`).join('')
    return `<p>${mark} <strong>${escapeHtml(f.title)}</strong></p><ul>${lines}</ul>`
  }).join('')

  return `<p><strong>Проверка на данните:</strong></p>${blocks}`
}

function checkStockMatchesBatches({ products, batches }: IntegrityInput): Finding[] {
  const sums = new Map<string, number>()
  for (const b of batches) {
    sums.set(b.product_id, (sums.get(b.product_id) || 0) + (b.quantity_remaining || 0))
  }

  const off = products
    .filter(p => p.status === 'active')
    .map(p => ({ name: p.name, shown: p.quantity_on_hand ?? 0, real: sums.get(p.id) || 0 }))
    .filter(p => p.shown !== p.real)
    .sort((a, b) => Math.abs(b.shown - b.real) - Math.abs(a.shown - a.real))

  if (off.length === 0) return []

  const excess = off.reduce((s, p) => s + (p.shown - p.real), 0)
  return [{
    check: 'stock_matches_batches',
    severity: 'error',
    title: `${off.length} продукта показват количество, различно от партидите (разлика ${excess > 0 ? '+' : ''}${excess} бр.)`,
    detail: off.slice(0, MAX_DETAIL_LINES).map(p => `${p.name}: показва ${p.shown}, в партидите ${p.real}`),
  }]
}

function checkNoNegativeBatches({ batches, products }: IntegrityInput): Finding[] {
  const names = new Map(products.map(p => [p.id, p.name]))
  const negative = batches.filter(b => b.quantity_remaining < 0)
  if (negative.length === 0) return []

  return [{
    check: 'no_negative_batches',
    severity: 'error',
    title: `${negative.length} партиди с отрицателно количество`,
    detail: negative.slice(0, MAX_DETAIL_LINES)
      .map(b => `${names.get(b.product_id) || b.product_id}: ${b.quantity_remaining}`),
  }]
}

function checkSalesHaveMovements({ recentSales, movementSaleIds }: IntegrityInput): Finding[] {
  const moved = new Set(movementSaleIds)
  const missing = recentSales.filter(s => !moved.has(s.id))
  if (missing.length === 0) return []

  return [{
    check: 'sales_have_movements',
    severity: 'error',
    title: `${missing.length} от ${recentSales.length} продажби за последните 7 дни нямат движение на стоката`,
    detail: [
      'Продажбата е записана, но наличността в партидите не е намалена.',
      ...missing.slice(0, MAX_DETAIL_LINES).map(s => `продажба ${s.id}`),
    ],
  }]
}

// ---------------------------------------------------------------------------
// Deliveries (phase 1). The functions keep these rules inside one transaction
// and the table constraints back them up; the checks are here to catch what a
// later change, a manual fix in the SQL editor or a restore might break.

/** Delivery statuses whose plan rows still wait for stock to leave Офис. */
const OPEN_DELIVERY = new Set(['expected', 'in_progress'])

/** A sent shipment unconfirmed for longer than this is worth a look. */
const SHIPMENT_CONFIRM_DAYS = 3

function checkDeliveries(input: IntegrityInput): Finding[] {
  const d = input.deliveries
  if (!d) return []
  if ('unavailable' in d) {
    return [{
      check: 'deliveries_unavailable',
      // Tables not migrated yet: expected for a while in production, so only
      // a note. Any other failure to read them is a real problem.
      severity: d.missingTables ? 'warning' : 'error',
      title: d.missingTables
        ? 'Проверките на доставките не са изпълнени: таблиците за доставки още ги няма'
        : 'Проверките на доставките не можаха да се изпълнят',
      detail: [d.unavailable],
    }]
  }

  return [
    ...checkPlanCounters(input, d),
    ...checkReadyWithinReceived(input, d),
    ...checkReadyStockInWarehouse(input, d),
    ...checkShipmentsConfirmed(d),
  ]
}

function deliveryLabel(n: number | null | undefined): string {
  return n == null ? 'чернова' : `Д-${String(n).padStart(6, '0')}`
}

function lookups(input: IntegrityInput, d: DeliveriesInput) {
  return {
    productName: new Map(input.products.map(p => [p.id, p.name])),
    storeName: new Map(d.stores.map(s => [s.id, s.name])),
    item: new Map(d.items.map(i => [i.id, i])),
    delivery: new Map(d.deliveries.map(x => [x.id, x])),
  }
}

/** ready never above planned, shipped never above ready. */
function checkPlanCounters(input: IntegrityInput, d: DeliveriesInput): Finding[] {
  const bad = d.plans.filter(p => p.shipped_qty > p.ready_qty || p.ready_qty > p.planned_qty)
  if (bad.length === 0) return []

  const { productName, storeName, item, delivery } = lookups(input, d)
  return [{
    check: 'delivery_plan_counters',
    severity: 'error',
    title: `${bad.length} реда от плана на доставките с изпратено над готовото или готово над планираното`,
    detail: bad.slice(0, MAX_DETAIL_LINES).map(p => {
      const it = item.get(p.delivery_item_id)
      const product = it ? productName.get(it.product_id) || it.product_id : p.delivery_item_id
      const del = it ? deliveryLabel(delivery.get(it.delivery_id)?.number) : '?'
      return `${del}, ${product} → ${storeName.get(p.store_id) || p.store_id}: `
        + `планирано ${p.planned_qty}, готово ${p.ready_qty}, изпратено ${p.shipped_qty}`
    }),
  }]
}

/** An item cannot have more units ready than it has received. */
function checkReadyWithinReceived(input: IntegrityInput, d: DeliveriesInput): Finding[] {
  const ready = new Map<string, number>()
  for (const p of d.plans) {
    ready.set(p.delivery_item_id, (ready.get(p.delivery_item_id) || 0) + (p.ready_qty || 0))
  }

  const bad = d.items
    .map(i => ({ item: i, ready: ready.get(i.id) || 0 }))
    .filter(x => x.ready > (x.item.received_qty || 0))
  if (bad.length === 0) return []

  const { productName, delivery } = lookups(input, d)
  return [{
    check: 'delivery_ready_within_received',
    severity: 'error',
    title: `${bad.length} реда от доставки с повече готови бройки от получените`,
    detail: bad.slice(0, MAX_DETAIL_LINES).map(x =>
      `${deliveryLabel(delivery.get(x.item.delivery_id)?.number)}, `
      + `${productName.get(x.item.product_id) || x.item.product_id}: готови ${x.ready}, получени ${x.item.received_qty}`),
  }]
}

/**
 * Units marked ready but not yet shipped must still be in Офис. Офис also
 * sells, so less there means a shipment will fail when the trip is sent.
 */
function checkReadyStockInWarehouse(input: IntegrityInput, d: DeliveriesInput): Finding[] {
  const warehouses = new Set(d.stores.filter(s => s.is_warehouse).map(s => s.id))
  if (warehouses.size === 0) return []

  const { item, delivery, productName } = lookups(input, d)
  const waiting = new Map<string, number>()
  for (const p of d.plans) {
    const it = item.get(p.delivery_item_id)
    if (!it) continue
    const status = delivery.get(it.delivery_id)?.status
    if (!status || !OPEN_DELIVERY.has(status)) continue
    const n = (p.ready_qty || 0) - (p.shipped_qty || 0)
    if (n > 0) waiting.set(it.product_id, (waiting.get(it.product_id) || 0) + n)
  }
  if (waiting.size === 0) return []

  const inWarehouse = new Map<string, number>()
  for (const b of input.batches) {
    if (!warehouses.has(b.store_id)) continue
    inWarehouse.set(b.product_id, (inWarehouse.get(b.product_id) || 0) + (b.quantity_remaining || 0))
  }

  const short = [...waiting]
    .map(([productId, ready]) => ({ productId, ready, have: inWarehouse.get(productId) || 0 }))
    .filter(x => x.have < x.ready)
    .sort((a, b) => (b.ready - b.have) - (a.ready - a.have))
  if (short.length === 0) return []

  return [{
    check: 'delivery_ready_stock_in_warehouse',
    severity: 'warning',
    title: `${short.length} продукта са готови за изпращане, но в Офис има по-малко`,
    detail: short.slice(0, MAX_DETAIL_LINES).map(x =>
      `${productName.get(x.productId) || x.productId}: готови ${x.ready}, в Офис ${x.have}`),
  }]
}

/** A shipment sent but not confirmed by the store after three days. */
function checkShipmentsConfirmed(d: DeliveriesInput): Finding[] {
  const cutoff = d.now - SHIPMENT_CONFIRM_DAYS * 24 * 60 * 60 * 1000
  const late = d.sentShipments
    .filter(s => s.sent_at && new Date(s.sent_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.sent_at!).getTime() - new Date(b.sent_at!).getTime())
  if (late.length === 0) return []

  const storeName = new Map(d.stores.map(s => [s.id, s.name]))
  return [{
    check: 'shipments_unconfirmed',
    severity: 'warning',
    title: `${late.length} пратки са изпратени преди повече от ${SHIPMENT_CONFIRM_DAYS} дни и обектът не ги е потвърдил`,
    detail: late.slice(0, MAX_DETAIL_LINES).map(s =>
      `П-${String(s.number).padStart(6, '0')} → ${storeName.get(s.store_id) || s.store_id}, `
      + `изпратена ${new Date(s.sent_at!).toISOString().slice(0, 10)}`),
  }]
}
