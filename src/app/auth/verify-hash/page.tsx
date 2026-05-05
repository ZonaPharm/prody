'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function VerifyHashPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Обработка на вход...')

  useEffect(() => {
    const supabase = createClient()

    async function handleSession(session: { access_token: string; refresh_token: string }) {
      setStatus('Синхронизиране на сесия...')
      // Sync session to server-side cookies so proxy sees it
      await fetch('/api/auth/set-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
      })
      setStatus('Влязохте успешно. Пренасочване...')
      router.push('/')
      router.refresh()
    }

    // Listen for SIGNED_IN event (fires when hash is processed by Supabase SDK)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        handleSession(session)
      }
    })

    // Also check if already signed in (hash may have been processed before listener attached)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        handleSession(session)
      }
    })

    // Timeout fallback — if no session after 10s, something went wrong
    const timeout = setTimeout(() => {
      setStatus('Неуспешен вход. Моля опитайте отново от страницата за вход.')
    }, 10000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-lg">{status}</p>
      </div>
    </div>
  )
}
