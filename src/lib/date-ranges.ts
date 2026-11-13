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
