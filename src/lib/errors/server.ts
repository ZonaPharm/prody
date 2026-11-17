import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildErrorRecord, consoleArgsToError, describeError, sessionUserIdFromCookieHeader,
  type ErrorInput,
} from './shape'

/**
 * Server side of error tracking: every error goes to app_errors, and a new
 * one sends an e-mail (src/lib/errors/alert.ts).
 *
 * Three ways in:
 * - handleRequestError: Next.js calls it (src/instrumentation.ts,
 *   onRequestError) for anything a page, route, server action or the proxy
 *   throws and does not catch.
 * - console.error: caught-and-logged failures ("tasks: notifications failed")
 *   are as important as thrown ones, and the code already logs them. After
 *   captureConsoleErrors() each console.error is also recorded.
 * - recordError: called directly, e.g. by POST /api/errors for the browser.
 *
 * Rules that keep this from making things worse:
 * - It never throws and never slows down the request: the write runs in the
 *   background (waitUntil keeps the function alive until it is done).
 * - Its own failures go to the ORIGINAL console.error, never to the patched
 *   one, so a broken database cannot turn into an endless loop of errors about
 *   errors.
 * - The same error from the same server instance is written at most once every
 *   few seconds, and an instance writes at most RATE_PER_MINUTE a minute, so a
 *   loop that fails a thousand times a second costs a handful of writes.
 */

/**
 * Keeps a Vercel function alive until p is done, as waitUntil from
 * @vercel/functions does (the same five lines; that package brings 18 others).
 * Elsewhere (next start, tests) there is no such context and the promise
 * simply finishes on its own.
 */
export function keepAlive(p: Promise<unknown>): void {
  try {
    const ctx = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.()
    ctx?.waitUntil?.(p)
  } catch { /* nothing to keep alive */ }
}

const RAW_CONSOLE_KEY = Symbol.for('prody.rawConsoleError')
const PATCHED_KEY = Symbol.for('prody.consolePatched')
const SAME_ERROR_WINDOW_MS = 5_000
const RATE_PER_MINUTE = 60
const CONSOLE_DEFER_MS = 50

/** console.error as it was before captureConsoleErrors(). */
export function rawConsoleError(...args: unknown[]): void {
  const raw = (globalThis as any)[RAW_CONSOLE_KEY] as ((...a: unknown[]) => void) | undefined
  ;(raw || console.error).apply(console, args)
}

const recent = new Map<string, number>()
let windowStart = 0
let windowCount = 0
/** Errors already recorded through onRequestError, so Next's own console line does not count them twice. */
const recordedRequestErrors = new WeakSet<object>()

function allowed(fingerprint: string, now: number): boolean {
  const last = recent.get(fingerprint)
  if (last !== undefined && now - last < SAME_ERROR_WINDOW_MS) return false
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0 }
  if (windowCount >= RATE_PER_MINUTE) return false
  windowCount++
  recent.set(fingerprint, now)
  if (recent.size > 500) {
    for (const [k, t] of recent) if (now - t > SAME_ERROR_WINDOW_MS) recent.delete(k)
  }
  return true
}

/** For tests only. */
export function _resetThrottle(): void {
  recent.clear(); windowStart = 0; windowCount = 0
}

function release(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  return sha ? sha.slice(0, 7) : null
}

/** Writes one error. Resolves when done; never rejects. */
export async function recordError(input: ErrorInput): Promise<void> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
    const record = buildErrorRecord({ release: release(), ...input })
    if (!record) return
    if (!allowed(record.p_fingerprint, Date.now())) return

    const admin = createAdminClient()
    if (record.p_user_id && !record.p_user_name) {
      const { data: u } = await (admin.from('users') as any)
        .select('display_name, email').eq('id', record.p_user_id).maybeSingle()
      if (u) record.p_user_name = u.display_name || u.email || null
      else record.p_user_id = null
    }
    const { data: needsAlert, error } = await (admin as any).rpc('report_app_error', record)
    if (error) {
      rawConsoleError('app_errors: could not record an error:', JSON.stringify(error))
      return
    }
    if (needsAlert === true) {
      const { sendErrorAlert } = await import('./alert')
      await sendErrorAlert()
    }
  } catch (e) {
    rawConsoleError('app_errors: could not record an error:', e)
  }
}

/** Fire and forget, but keep the serverless function alive until the write is done. */
export function recordErrorInBackground(input: ErrorInput): void {
  const p = recordError(input)
  keepAlive(p)
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const v = headers[name]
  return Array.isArray(v) ? v.join('; ') : v ?? null
}

/** Next.js onRequestError. */
export async function handleRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routeType: string },
): Promise<void> {
  if (err && typeof err === 'object') recordedRequestErrors.add(err)
  const d = describeError(err)
  await recordError({
    source: 'server',
    kind: context.routeType || 'request',
    message: d.message,
    stack: d.stack,
    digest: d.digest,
    path: request.path,
    method: request.method,
    userId: sessionUserIdFromCookieHeader(header(request.headers, 'cookie')),
    userAgent: header(request.headers, 'user-agent'),
  })
}

/** Also record every console.error. Safe to call more than once. */
export function captureConsoleErrors(): void {
  const g = globalThis as any
  if (g[PATCHED_KEY]) return
  g[PATCHED_KEY] = true
  const original = console.error.bind(console)
  g[RAW_CONSOLE_KEY] = original

  console.error = (...args: unknown[]) => {
    original(...args)
    try {
      const parsed = consoleArgsToError(args)
      if (parsed.error && recordedRequestErrors.has(parsed.error)) return
      // Next may print a request error before it calls onRequestError; wait a
      // moment so that one is recorded once, with its page, by the hook.
      const p = new Promise<void>(resolve => setTimeout(resolve, CONSOLE_DEFER_MS)).then(() => {
        if (parsed.error && recordedRequestErrors.has(parsed.error)) return
        return recordError({
          source: 'server',
          kind: 'log',
          message: parsed.message,
          stack: parsed.stack,
          digest: parsed.digest,
        })
      })
      keepAlive(p)
    } catch (e) {
      original('app_errors: console capture failed:', e)
    }
  }
}

/** Errors not seen for this many days are deleted by the nightly job. */
export const KEEP_DAYS = 90

export async function cleanupOldErrors(days = KEEP_DAYS): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const { count, error } = await (createAdminClient().from('app_errors') as any)
      .delete({ count: 'exact' }).lt('last_seen', cutoff)
    if (error) { rawConsoleError('app_errors: cleanup failed:', JSON.stringify(error)); return 0 }
    return count || 0
  } catch (e) {
    rawConsoleError('app_errors: cleanup failed:', e)
    return 0
  }
}
