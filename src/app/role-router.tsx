'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function parseHashTokens(): { access_token: string; refresh_token: string } | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.substring(1)
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return null
  // Clear hash from URL without reload
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return { access_token, refresh_token }
}

async function syncToCookies(access_token: string, refresh_token: string) {
  await fetch('/api/auth/set-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token, refresh_token }),
  })
}

export function RoleRouter() {
  const router = useRouter()

  useEffect(() => {
    // 1. Check for hash tokens first (admin-generated magic links)
    const tokens = parseHashTokens()
    if (tokens) {
      syncToCookies(tokens.access_token, tokens.refresh_token).then(() => {
        router.push('/')
        router.refresh()
      })
      return
    }

    // 2. Check existing Supabase session (normal PKCE flow)
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Already have client-side session → sync to cookies just in case
        await syncToCookies(session.access_token, session.refresh_token)
        router.push('/')
        router.refresh()
      } else {
        // Listen for SIGNED_IN before giving up
        const timeout = setTimeout(() => router.push('/login'), 5000)

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session) {
            clearTimeout(timeout)
            await syncToCookies(session.access_token, session.refresh_token)
            router.push('/')
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
