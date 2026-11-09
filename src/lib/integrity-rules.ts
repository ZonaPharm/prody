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
