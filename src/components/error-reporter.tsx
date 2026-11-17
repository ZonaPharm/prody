'use client'

import { useEffect } from 'react'
import { reportBrowserError } from '@/lib/errors/client'

/**
 * Catches what no code caught in the browser: a script error, or a promise
 * that failed with no .catch. Rendered once, in the root layout.
 * Errors on a page with an error screen (error.tsx) are reported there.
 */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportBrowserError('window', e.error ?? e.message)
    const onRejection = (e: PromiseRejectionEvent) => reportBrowserError('promise', e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
