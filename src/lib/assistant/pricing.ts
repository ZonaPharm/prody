/**
 * What one call to the model costs, and whether the month's cap is reached.
 * Pure: no database, no network (tested in pricing.test.ts).
 *
 * DeepSeek list prices, US dollars per million tokens (api-docs.deepseek.com,
 * read 2026-11-13). Peak hours cost double: 01:00-04:00 and 06:00-10:00 UTC,
 * Monday to Friday. Chinese public holidays are off-peak there, but we price
 * them as peak: the record may show a little more than was charged, never less.
 */

/** deepseek-flash is DeepSeek-V4.1-Flash (Владимир's choice, 2026-11-13). */
export const ASSISTANT_MODEL = process.env.DEEPSEEK_ASSISTANT_MODEL || 'deepseek-flash'

type Price = { hit: number; miss: number; output: number }

/** Off-peak prices. */
const PRICES: Record<string, Price> = {
  'deepseek-v4-pro': { hit: 0.022, miss: 0.66, output: 1.98 },
  'deepseek-flash': { hit: 0.003, miss: 0.15, output: 0.6 },
}

/** A model we did not list is priced as the dearest we know. */
const UNKNOWN = PRICES['deepseek-v4-pro']

export type TokenUsage = {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  prompt_cache_hit_tokens?: number | null
  prompt_cache_miss_tokens?: number | null
}

export function priceOf(model: string): Price {
  const key = Object.keys(PRICES).find(k => model === k || model.startsWith(k + '-'))
  return key ? PRICES[key] : UNKNOWN
}

/** DeepSeek's peak window, in UTC. */
export function isPeak(at: Date): boolean {
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return false
  const h = at.getUTCHours()
  return (h >= 1 && h < 4) || (h >= 6 && h < 10)
}

const n = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? v : 0)

/** The usage split the way the cost record stores it. */
export function splitUsage(u: TokenUsage) {
  const hit = n(u.prompt_cache_hit_tokens)
  // Older responses may give only prompt_tokens: count all of it as a miss.
  const miss = u.prompt_cache_miss_tokens != null ? n(u.prompt_cache_miss_tokens) : Math.max(0, n(u.prompt_tokens) - hit)
  return { hit, miss, output: n(u.completion_tokens) }
}

/** Cost in dollars of one model call made at `at`. */
export function costUsd(model: string, usage: TokenUsage, at: Date = new Date()): number {
  const p = priceOf(model)
  const k = isPeak(at) ? 2 : 1
  const { hit, miss, output } = splitUsage(usage)
  const dollars = (k * (hit * p.hit + miss * p.miss + output * p.output)) / 1_000_000
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
