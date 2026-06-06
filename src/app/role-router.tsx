'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

async function syncAndRedirect(
  access_token: string,
  refresh_token: string,
): Promise<string> {
  const resp = await fetch('/api/auth/set-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token, refresh_token }),
  })
  const data = await resp.json()
  return data.redirectTo || '/record-sale'
}

export function RoleRouter() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const redirectTo = await syncAndRedirect(session.access_token, session.refresh_token)
        router.push(redirectTo)
        router.refresh()
      } else {
        // Listen for SIGNED_IN before giving up
        const timeout = setTimeout(() => router.push('/login'), 5000)

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session) {
            clearTimeout(timeout)
            const redirectTo = await syncAndRedirect(session.access_token, session.refresh_token)
            router.push(redirectTo)
            router.refresh()
          }
        })

        return () => {
          clearTimeout(timeout)
          subscription.unsubscribe()
        }
      }
    })
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )
}
