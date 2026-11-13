/**
 * Small pure helpers for the assistant's tools (tested in util.test.ts).
 */
import { sofiaToday } from '@/lib/date-utils'

const DATE = /^\d{4}-\d{2}-\d{2}$/

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export type Range = { from: string; to: string }

/**
 * A date range from what the model asked for. Missing ends default to the last
 * `defaultDays` days up to today (Sofia). A range longer than `maxDays` or with
 * from after to is refused with a message the model can act on.
 */
export function dateRange(
  from: string | undefined,
  to: string | undefined,
  opts: { defaultDays: number; maxDays: number; today?: string },
): Range | { error: string } {
  const today = opts.today ?? sofiaToday()
  const end = to ?? today
  const start = from ?? shiftDays(end, -(opts.defaultDays - 1))
  if (!validDate(start) || !validDate(end)) return { error: 'Датите трябва да са във вида ГГГГ-ММ-ДД.' }
  if (start > end) return { error: 'Началната дата е след крайната.' }
  if (daysBetween(start, end) + 1 > opts.maxDays) {
    return { error: `Периодът е твърде дълъг (най-много ${opts.maxDays} дни). Разделете го на части.` }
  }
  return { from: start, to: end }
}

export function shiftDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000)
}

/**
 * A range of whole Sofia days as timestamps, for timestamptz columns. Sofia is
 * UTC+2 or +3; widening by three hours on the left and leaving the right end at
 * the next UTC midnight + 0 keeps every Sofia moment of those days inside
 * (at most a couple of hours of a neighbouring day slip in, which is fine for
 * a log search).
 */
export function timestampRange(r: Range): { fromTs: string; toTs: string } {
  const fromTs = new Date(new Date(r.from + 'T00:00:00Z').getTime() - 3 * 3_600_000).toISOString()
  const toTs = new Date(r.to + 'T00:00:00Z').getTime() + 86_400_000
  return { fromTs, toTs: new Date(toTs).toISOString() }
}

/**
 * Text people typed (product names, notes, log details) goes to the model as
 * data. Keep it short so one long note cannot crowd out the rest.
 */
export function clip(value: unknown, max = 300): string | null {
  if (value == null) return null
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** Rounds money to stotinki. */
export function money(v: number): number {
  return Math.round(v * 100) / 100
}

/** A search term that is safe inside a PostgREST or() filter and ilike. */
export function searchTerm(q: string): string {
  return q.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Postgres embeds come back as an object or a one-element array. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/**
 * The JSON a tool hands back to the model. Very large results are cut, and the
 * model is told so, rather than sending the whole thing.
 */
export function toolJson(value: unknown, maxChars = 40_000): string {
  const s = JSON.stringify(value)
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars) + `… [резултатът е съкратен: ${s.length} знака; стеснете търсенето]`
}

export type GroupKey = 'none' | 'day' | 'store' | 'seller' | 'product' | 'payment_method'

export type SaleRow = {
  quantity: number
  sale_price: number | string
  sale_date: string
  store_id: string
  sold_by: string
  product_id: string
  payment_method: string | null
}

export type SalesGroup = { key: string; label: string; revenue: number; units: number; lines: number }

/**
 * Totals of sales lines, optionally grouped. Revenue = quantity × sale_price,
 * as in Отчети. The caller passes only lines that are not voided.
 */
export function summariseSales(
  rows: SaleRow[],
  groupBy: GroupKey,
  label: (key: string) => string = k => k,
): { revenue: number; units: number; lines: number; groups: SalesGroup[] } {
  let revenue = 0
  let units = 0
  const map = new Map<string, SalesGroup>()
  for (const r of rows) {
    const rev = r.quantity * Number(r.sale_price)
    revenue += rev
    units += r.quantity
    if (groupBy === 'none') continue
    const key =
      groupBy === 'day' ? r.sale_date
      : groupBy === 'store' ? r.store_id
      : groupBy === 'seller' ? r.sold_by
      : groupBy === 'product' ? r.product_id
      : r.payment_method || 'cash'
    const g = map.get(key) ?? { key, label: label(key), revenue: 0, units: 0, lines: 0 }
    g.revenue += rev
    g.units += r.quantity
    g.lines += 1
    map.set(key, g)
  }
  const groups = [...map.values()].map(g => ({ ...g, revenue: money(g.revenue) }))
  if (groupBy === 'day') groups.sort((a, b) => a.key.localeCompare(b.key))
  else groups.sort((a, b) => b.revenue - a.revenue)
  return { revenue: money(revenue), units, lines: rows.length, groups }
}
