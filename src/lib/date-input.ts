/**
 * Dates as people in the stores write them: дд.мм.гггг (8.11.2026, 08.11.26).
 *
 * The browser's own date field shows the date in the browser's language, so an
 * English browser shows 11/08/2026 and nobody can tell 8 November from
 * 11 August. The date fields now show and take дд.мм.гггг whatever the
 * browser's language; the app still works with YYYY-MM-DD inside.
 */
import { usableDate } from '@/lib/date-ranges'

/** YYYY-MM-DD -> дд.мм.гггг; anything else -> ''. */
export function formatDateBg(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/**
 * What is typed -> YYYY-MM-DD, or null if it is not a whole, real date yet.
 * Takes 8.11.2026, 08.11.2026, 8/11/2026, 8-11-2026, 08112026, and with
 * shortYear also 8.11.26 and 081126 (26 -> 2026).
 */
export function parseDateBg(text: string, { shortYear = false } = {}): string | null {
  const t = text.trim()
  let d: string, m: string, y: string
  const parts = t.split(/[.\/\-\s,]+/).filter(Boolean)
  if (parts.length === 3) {
    ;[d, m, y] = parts
  } else if (parts.length === 1 && /^\d{8}$/.test(t)) {
    ;[d, m, y] = [t.slice(0, 2), t.slice(2, 4), t.slice(4)]
  } else if (parts.length === 1 && /^\d{6}$/.test(t)) {
    ;[d, m, y] = [t.slice(0, 2), t.slice(2, 4), t.slice(4)]
  } else {
    return null
  }
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m)) return null
  if (/^\d{2}$/.test(y)) {
    if (!shortYear) return null
    y = '20' + y
  } else if (!/^\d{4}$/.test(y)) {
    return null
  }
  const ymd = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  return usableDate(ymd) ? ymd : null
}

/**
 * Puts the dots in while someone types digits, so a phone's number pad is
 * enough: 0811 -> 08.11, 08112026 -> 08.11.2026. Once a person writes a short
 * part themselves (8.11) the text is left as typed.
 */
export function autoDots(text: string): string {
  const groups = text.split(/[.\/\-\s,]/)
  const own = groups.slice(0, -1).some(g => g.length !== 2) || /[^\d.\/\-\s,]/.test(text)
  if (own) return text.slice(0, 10)
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}
