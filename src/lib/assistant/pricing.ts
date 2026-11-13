/**
 * What one call to the model costs, and whether the month's cap is reached.
 * Pure: no database, no network (tested in pricing.test.ts).
 *
 * Prices are US dollars per million tokens (Anthropic list prices, Nov 2026).
 * A cache write costs 1.25 × input (5-minute cache), a cache read is listed.
 */

export const ASSISTANT_MODEL = 'claude-opus-5-5'

type Price = { input: number; output: number; cacheRead: number }

const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
}

/** An unknown model (a server-side fallback we did not list) is priced as the dearest we know. */
const UNKNOWN: Price = { input: 5, output: 25, cacheRead: 0.5 }

export type TokenUsage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function priceOf(model: string): Price {
  // A response may name a dated or suffixed id; match on the prefix.
  const key = Object.keys(PRICES).find(k => model === k || model.startsWith(k + '-'))
  return key ? PRICES[key] : UNKNOWN
}

/** Cost in dollars of one model call. */
export function costUsd(model: string, usage: TokenUsage): number {
  const p = priceOf(model)
  const n = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : 0)
  const dollars =
    (n(usage.input_tokens) * p.input +
      n(usage.cache_creation_input_tokens) * p.input * 1.25 +
      n(usage.cache_read_input_tokens) * p.cacheRead +
      n(usage.output_tokens) * p.output) / 1_000_000
  return Math.round(dollars * 1_000_000) / 1_000_000
}

/** First moment of the current month in Sofia, as an ISO string (UTC). */
export function monthStartIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit' })
    .formatToParts(now)
  const y = Number(parts.find(p => p.type === 'year')?.value)
  const m = Number(parts.find(p => p.type === 'month')?.value)
  // Midnight on the 1st in Sofia is 22:00 or 21:00 UTC the day before; take the
  // earlier one so nothing from the 1st is missed (at most an hour of the last
  // day of the previous month counts twice, which only errs on the safe side).
  return new Date(Date.UTC(y, m - 1, 1) - 3 * 60 * 60 * 1000).toISOString()
}

export type CapCheck = { ok: true; spent: number; cap: number } | { ok: false; spent: number; cap: number; message: string }

/** May one more question be asked this month? */
export function checkCap(spent: number, cap: number): CapCheck {
  if (cap <= 0) return { ok: false, spent, cap, message: 'AI асистентът е спрян: месечният таван е 0 $. Администратор може да го промени в Настройки → AI.' }
  if (spent >= cap) {
    return {
      ok: false, spent, cap,
      message: `Месечният таван от ${formatUsd(cap)} е достигнат (похарчени ${formatUsd(spent)}). Администратор може да го вдигне в Настройки → AI.`,
    }
  }
  return { ok: true, spent, cap }
}

export function formatUsd(v: number): string {
  return `${v.toFixed(2)} $`
}
