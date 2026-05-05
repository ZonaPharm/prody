'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

function parseHashTokens(): { access_token: string; refresh_token: string } | null {
  const hash = window.location.hash.substring(1)
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return { access_token, refresh_token }
}

export default function VerifyHashPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Обработка на вход...')

  useEffect(() => {
    const tokens = parseHashTokens()
    if (!tokens) {
      setStatus('Неуспешен вход. Моля опитайте отново от страницата за вход.')
      return
    }

    setStatus('Синхронизиране на сесия...')
    fetch('/api/auth/set-cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens),
    }).then(() => {
      setStatus('Влязохте успешно. Пренасочване...')
      router.push('/')
      router.refresh()
    }).catch(() => {
      setStatus('Неуспешен вход. Моля опитайте отново.')
    })
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
