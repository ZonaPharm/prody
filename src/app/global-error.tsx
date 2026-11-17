'use client'

import { useEffect } from 'react'
import { reportBrowserError } from '@/lib/errors/client'

/**
 * Shown only when the root layout itself fails, so it brings its own
 * <html> and <body> and cannot rely on the app's styles.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!error.digest) reportBrowserError('global', error)
  }, [error])

  return (
    <html lang="bg">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, padding: 16 }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Нещо се обърка</h2>
          <p style={{ color: '#475569', marginBottom: 16 }}>Приложението не успя да се зареди.</p>
          <button
            onClick={reset}
            style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}
          >
            Опитай отново
          </button>
          <p style={{ marginTop: 16, fontSize: 12, color: '#64748b' }}>
            Грешката е записана и администраторът ще я види.
            {error.digest && <> Код: <span style={{ fontFamily: 'monospace' }}>{error.digest}</span></>}
          </p>
        </div>
      </body>
    </html>
  )
}
