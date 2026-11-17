import { describeError, isNoise, type BrowserErrorPayload } from './shape'

/**
 * Browser side of error tracking. Sends an error to POST /api/errors, which
 * stores it with the signed-in user (src/lib/errors/server.ts).
 *
 * One page load sends at most MAX_PER_PAGE reports and each different message
 * once, so a component failing on every render cannot flood the server.
 * Never throws: reporting an error must not cause one.
 */
const MAX_PER_PAGE = 10
const sent = new Set<string>()

export function reportBrowserError(kind: BrowserErrorPayload['kind'], error: unknown, digest?: string | null): void {
  try {
    const d = describeError(error)
    const message = d.message.slice(0, 5000)
    if (!message || isNoise(message, d.stack)) return
    if (sent.has(message) || sent.size >= MAX_PER_PAGE) return
    sent.add(message)
    const body: BrowserErrorPayload = {
      kind,
      message,
      stack: d.stack ? d.stack.slice(0, 20000) : null,
      path: window.location.pathname,
      digest: digest ?? d.digest,
    }
    // keepalive: the report still goes out if the page is being left or reloaded.
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  } catch { /* nothing more to do */ }
}
