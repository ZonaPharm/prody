'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function VerifyHashPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Обработка на вход...')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        setStatus('Влязохте успешно. Пренасочване...')
        router.push('/')
        router.refresh()
      }
    })
    // Also check if already signed in (hash may already be processed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/')
        router.refresh()
      } else {
        setStatus('Неуспешен вход. Моля опитайте отново от страницата за вход.')
      }
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
