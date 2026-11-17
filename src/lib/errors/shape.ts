import { z } from 'zod'

/**
 * Turning "something went wrong" into one row of app_errors.
 *
 * Pure: no database, no network, safe in the browser and on the server, and
 * covered by shape.test.ts. The server side (src/lib/errors/server.ts) and the
 * browser side (src/lib/errors/client.ts) both go through here, so an error
 * looks the same on the Грешки screen wherever it came from.
 */

export type ErrorSource = 'server' | 'browser'

export const LIMITS = {
  message: 2000,
  stack: 8000,
  path: 500,
  method: 10,
  digest: 100,
  release: 40,
  userName: 200,
  userAgent: 500,
} as const

export interface ErrorInput {
  source: ErrorSource
  /** route, render, action, proxy, log, window, promise, boundary */
  kind: string
  message: string
  stack?: string | null
  path?: string | null
  method?: string | null
  digest?: string | null
  release?: string | null
  userId?: string | null
  userName?: string | null
  userAgent?: string | null
}

/** What report_app_error takes, ready to send. */
export interface ErrorRecord {
  p_fingerprint: string
  p_source: ErrorSource
  p_kind: string
  p_message: string
  p_stack: string | null
  p_path: string | null
  p_method: string | null
  p_digest: string | null
  p_release: string | null
  p_user_id: string | null
  p_user_name: string | null
  p_user_agent: string | null
}

export function cut(value: unknown, max: number): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/g
const HEX_ID = /\b[0-9a-f]{16,}\b/gi
const NUMBER = /\d+/g

/**
 * The part of a message that says what went wrong, without the parts that
 * change every time (ids, times, numbers), so the same fault is counted as one
 * error instead of a new row per product or per minute.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID, '<id>')
    .replace(ISO_TIME, '<time>')
    .replace(HEX_ID, '<hex>')
    .replace(NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

/** cyrb53: a small, fast, stable string hash. Not for security, only grouping. */
function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Same source and same normalized message = same error. The page is not part of it. */
export function errorFingerprint(source: ErrorSource, message: string): string {
  const key = `${source}|${normalizeMessage(message)}`
  return `${source[0]}${hash53(key).toString(16).padStart(14, '0')}${hash53(key, 7).toString(16).padStart(14, '0')}`
}

/**
 * Things that are not faults of the app and would only bury the real ones:
 * Next's own control flow (redirect, notFound), a session that simply expired,
 * browser and extension noise.
 */
const NOISE: RegExp[] = [
  /NEXT_REDIRECT/,
  /NEXT_NOT_FOUND/,
  /NEXT_HTTP_ERROR_FALLBACK/,
  /DYNAMIC_SERVER_USAGE/,
  /BAILOUT_TO_CLIENT_SIDE_RENDERING/,
  /refresh_token_not_found|Invalid Refresh Token/i,
  /ResizeObserver loop/,
  /^Script error\.?$/,
  /AbortError|The (user|operation) aborted/i,
]
const EXTENSION_STACK = /(chrome|moz|safari(-web)?)-extension:\/\//

export function isNoise(message: string, stack?: string | null): boolean {
  if (NOISE.some(re => re.test(message))) return true
  if (stack && EXTENSION_STACK.test(stack)) return true
  return false
}

/** null when it is noise or there is nothing to say. */
export function buildErrorRecord(input: ErrorInput): ErrorRecord | null {
  const message = cut(input.message, LIMITS.message)
  if (!message) return null
  if (isNoise(message, input.stack)) return null
  return {
    p_fingerprint: errorFingerprint(input.source, message),
    p_source: input.source,
    p_kind: cut(input.kind, 40) || 'unknown',
    p_message: message,
    p_stack: cut(input.stack, LIMITS.stack),
    p_path: cut(stripQuery(input.path), LIMITS.path),
    p_method: cut(input.method, LIMITS.method),
    p_digest: cut(input.digest, LIMITS.digest),
    p_release: cut(input.release, LIMITS.release),
    p_user_id: input.userId && UUID_ONE.test(input.userId) ? input.userId : null,
    p_user_name: cut(input.userName, LIMITS.userName),
    p_user_agent: cut(input.userAgent, LIMITS.userAgent),
  }
}
const UUID_ONE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Query strings can carry search text or tokens; the page is enough. */
export function stripQuery(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    if (/^https?:\/\//.test(path)) return new URL(path).pathname
  } catch { /* fall through */ }
  return path.split(/[?#]/)[0]
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value)
    return s === undefined ? String(value) : s
  } catch {
    return String(value)
  }
}

/** Whatever was thrown, as text. Supabase errors are plain objects with message and code. */
export function describeError(err: unknown): { message: string; stack: string | null; digest: string | null } {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : ''
    const code = (err as any).code ? ` [${(err as any).code}]` : ''
    return {
      message: `${name}${err.message || '(без текст)'}${code}`,
      stack: err.stack || null,
      digest: typeof (err as any).digest === 'string' ? (err as any).digest : null,
    }
  }
  if (typeof err === 'string') return { message: err, stack: null, digest: null }
  return { message: safeJson(err), stack: null, digest: null }
}

/**
 * console.error('tasks: notifications failed:', JSON.stringify(error)) becomes
 * one message. When an Error object is among the arguments, its stack is kept
 * and the error itself is returned so the caller can tell whether it was
 * already recorded as a request error.
 */
export function consoleArgsToError(args: unknown[]): { message: string; stack: string | null; digest: string | null; error: Error | null } {
  const parts: string[] = []
  let stack: string | null = null
  let digest: string | null = null
  let error: Error | null = null
  for (const a of args) {
    if (a instanceof Error) {
      const d = describeError(a)
      parts.push(d.message)
      if (!error) { error = a; stack = d.stack; digest = d.digest }
    } else if (typeof a === 'string') {
      parts.push(a)
    } else {
      parts.push(safeJson(a))
    }
  }
  // printf-style placeholders add nothing once the values follow them.
  const message = parts.join(' ').replace(/%[sdifoOc]/g, '').replace(/\s+/g, ' ').trim()
  return { message, stack, digest, error }
}

/** What the browser may send to POST /api/errors. Everything else is ignored. */
export const browserErrorSchema = z.object({
  kind: z.enum(['window', 'promise', 'boundary', 'global']),
  message: z.string().min(1).max(5000),
  stack: z.string().max(20000).nullish(),
  path: z.string().max(2000).nullish(),
  digest: z.string().max(200).nullish(),
})
export type BrowserErrorPayload = z.infer<typeof browserErrorSchema>

/** Alert recipients as typed on the screen: "a@x.bg, b@y.bg". */
export const alertRecipientsSchema = z.array(z.string().trim().max(255).regex(/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/)).max(10)

export function parseRecipients(text: string): string[] {
  return text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Who was signed in, read from the Supabase session cookie of a failed request,
 * only to show a name next to a server error. It is NOT verified and must never
 * be used to allow anything: the caller only looks the id up in public.users.
 * The cookie may be split into chunks (sb-<ref>-auth-token.0, .1, …) and may be
 * stored as "base64-<base64url JSON>".
 */
export function sessionUserIdFromCookieHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  try {
    const chunks = new Map<number, string>()
    let whole: string | null = null
    for (const part of cookieHeader.split(/;\s*/)) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const name = part.slice(0, eq).trim()
      const m = /^sb-[^.]+-auth-token(?:\.(\d+))?$/.exec(name)
      if (!m) continue
      const value = decodeURIComponent(part.slice(eq + 1).trim())
      if (m[1] === undefined) whole = value
      else chunks.set(Number(m[1]), value)
    }
    let raw = whole ?? (chunks.size ? [...chunks.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).join('') : null)
    if (!raw) return null
    if (raw.startsWith('base64-')) raw = decodeBase64Url(raw.slice(7))
    const session = JSON.parse(raw)
    const token: unknown = Array.isArray(session) ? session[0] : session?.access_token
    if (typeof token !== 'string') return null
    const payload = JSON.parse(decodeBase64Url(token.split('.')[1] || ''))
    return typeof payload?.sub === 'string' && UUID_ONE.test(payload.sub) ? payload.sub : null
  } catch {
    return null
  }
}
