import type { Instrumentation } from 'next'

/**
 * Next.js loads this once per server instance. It wires up error tracking
 * (src/lib/errors/server.ts): every console.error and every uncaught error of
 * a page, route, server action or the proxy goes to app_errors, which admins
 * see in Настройки → Грешки. Vercel's own log keeps them only an hour.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { captureConsoleErrors } = await import('@/lib/errors/server')
    captureConsoleErrors()
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { handleRequestError } = await import('@/lib/errors/server')
  await handleRequestError(err, request, context)
}
