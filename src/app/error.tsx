'use client'

import { useEffect } from 'react'
import { reportBrowserError } from '@/lib/errors/client'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // An error with a digest happened on the server, which has already
    // recorded it with the page and the user. Only browser-side ones are sent.
    if (!error.digest) reportBrowserError('boundary', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold mb-2">Нещо се обърка</h2>
        <p className="text-muted-foreground mb-4">{error.message || 'Неочаквана грешка'}</p>
        <button
          onClick={reset}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          Опитай отново
        </button>
        <p className="mt-4 text-xs text-slate-500">
          Грешката е записана и администраторът ще я види.
          {error.digest && <> Код: <span className="font-mono">{error.digest}</span></>}
        </p>
      </div>
    </div>
  )
}
