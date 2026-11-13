/**
 * "Днес / Седмица / Месец" for the sales filters, worked out from today's date
 * in Sofia (a YYYY-MM-DD string). The old buttons took the date in UTC, so
 * between midnight and 2–3 a.m. Sofia time "Днес" showed yesterday.
 * Pure date arithmetic on the calendar date, no time zones.
 */
export type QuickRange = 'today' | 'week' | 'month'

function parts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number)
  return [y, m, d]
}

function fmt(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function quickRange(kind: QuickRange, today: string): { from: string; to: string } {
  const [y, m, d] = parts(today)
  if (kind === 'today') return { from: today, to: today }
  if (kind === 'month') {
    return { from: fmt(new Date(Date.UTC(y, m - 1, 1))), to: fmt(new Date(Date.UTC(y, m, 0))) }
  }
  // Week: Monday to Sunday around today.
  const t = new Date(Date.UTC(y, m - 1, d))
  const dow = t.getUTCDay() // 0 = Sunday
  const monday = new Date(Date.UTC(y, m - 1, d - (dow === 0 ? 6 : dow - 1)))
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6))
  return { from: fmt(monday), to: fmt(sunday) }
}

/** Which quick button the current from–to matches, if any (to light it up). */
export function activeQuickRange(from: string, to: string, today: string): QuickRange | null {
  for (const k of ['today', 'week', 'month'] as const) {
    const r = quickRange(k, today)
    if (r.from === from && r.to === to) return k
  }
  return null
}

/**
 * A date the period filters may search with: a whole YYYY-MM-DD that is a
 * real calendar day, in 2000–2099. While someone types the year into a date
 * field, the browser reports 0002, 0020, 0202 and only then 2026; once the
 * focus slipped it even gave 52026. Each of those used to start a search, and
 * a year 0002 search reads every sale ever made.
 */
export function usableDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 2000 || y > 2099) return false
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** What a date field should do with what is typed in it now. */
export function dateFieldAction(typed: string, current: string): 'search' | 'wait' | 'nothing' {
  if (!usableDate(typed)) return 'wait'
  return typed === current ? 'nothing' : 'search'
}

function sofiaOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Sofia', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs
}

/**
 * The moment a Sofia calendar day starts, as an ISO time. The logs filter sent
 * "2026-11-13T00:00:00" with no zone, which the database reads as UTC, so the
 * day started at 02:00 (03:00 in summer) Sofia time. Clocks change at 03:00/04:00
 * local, never at midnight, so the offset at 00:00 UTC that day is the right one.
 */
export function sofiaDayStartIso(ymd: string): string {
  const [y, m, d] = parts(ymd)
  const guess = Date.UTC(y, m - 1, d)
  return new Date(guess - sofiaOffsetMs(guess)).toISOString()
}

/** The last millisecond of a Sofia calendar day, as an ISO time. */
export function sofiaDayEndIso(ymd: string): string {
  const [y, m, d] = parts(ymd)
  const next = fmt(new Date(Date.UTC(y, m - 1, d + 1)))
  return new Date(new Date(sofiaDayStartIso(next)).getTime() - 1).toISOString()
}

/**
 * What a date field shows once the page moves to a new date. If the field
 * asked for that date itself, keep what is in it: the person may already be
 * typing the next part (a search after the month must not wipe the year being
 * typed). Any other change (a quick button, Back) shows the page's date.
 */
export function fieldTextAfterPageChange(pageDate: string, askedFor: string | null, typed: string): string {
  return pageDate === askedFor ? typed : pageDate
}

/** Typing waits for a pause; a date picked from the calendar searches at once. */
export const TYPING_PAUSE_MS = 1000
