/**
 * The "Доставки" menu stays hidden until phases 2 and 3 are both live
 * (plan: "Менюто е скрито с превключвател"). One switch, read on the server:
 *
 *   DELIVERIES_ENABLED = "all"                 → every admin
 *   DELIVERIES_ENABLED = "a@x.bg,b@y.bg"       → only these admins (the pilot)
 *   DELIVERIES_ENABLED = "off" (or "0", "no")  → nobody
 *   not set                                    → on in Vercel preview and `next dev`
 *                                                 (both point at staging), off in production
 *
 * The pages answer 404 and the API routes 404 when it is off, so production
 * behaves exactly as before until the switch is set there.
 */

export type FeatureEnv = {
  DELIVERIES_ENABLED?: string
  VERCEL_ENV?: string
  NODE_ENV?: string
}

const OFF = new Set(['off', '0', 'no', 'false', 'none'])
const ALL = new Set(['all', 'on', '1', 'yes', 'true'])

export function deliveriesEnabledFor(email: string | null | undefined, env: FeatureEnv = process.env): boolean {
  const raw = (env.DELIVERIES_ENABLED ?? '').trim().toLowerCase()
  if (!raw) return env.VERCEL_ENV === 'preview' || env.NODE_ENV === 'development'
  if (OFF.has(raw)) return false
  if (ALL.has(raw)) return true
  const who = (email ?? '').trim().toLowerCase()
  if (!who) return false
  return raw.split(/[\s,;]+/).filter(Boolean).includes(who)
}

/**
 * For the stores' side ("Пратки" for sellers): on whenever any admin can work
 * with deliveries, so the pilot's shipments reach the stores they go to.
 * Off only when the switch is off (or unset in production).
 */
export function deliveriesActive(env: FeatureEnv = process.env): boolean {
  const raw = (env.DELIVERIES_ENABLED ?? '').trim().toLowerCase()
  if (!raw) return env.VERCEL_ENV === 'preview' || env.NODE_ENV === 'development'
  return !OFF.has(raw)
}
