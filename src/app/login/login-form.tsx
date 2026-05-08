'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const errorMessages: Record<string, string> = {
  no_code: 'Липсва код за потвърждение.',
  auth_callback_failed: 'Линкът за вход е невалиден или изтекъл. Опитай отново.',
}

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'password' | 'magiclink'>('password')
  const supabase = createClient()
  const searchParams = useSearchParams()

  useEffect(() => {
    const err = searchParams.get('error')
    if (err && errorMessages[err]) {
      setError(errorMessages[err])
    }
  }, [searchParams])

  useEffect(() => {
    const hash = window.location.hash.substring(1)
    if (hash) {
      const params = new URLSearchParams(hash)
      const access_token = params.get('access_token')
      const refresh_token = params.get('refresh_token')
      if (access_token && refresh_token) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        fetch('/api/auth/set-cookies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token, refresh_token }),
        }).then(() => { window.location.href = '/' })
        return
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.href = '/'
    })
  }, [])

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!password) { setError('Въведи парола'); return }
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      if (error.message?.includes('Invalid login credentials')) {
        setError('Грешен имейл или парола')
      } else {
        setError(error.message)
      }
      return
    }

    window.location.href = '/'
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Prody</CardTitle>
          <CardDescription>
            {sent ? 'Провери имейла си за линк за вход' : 'Влез в акаунта си'}
          </CardDescription>
        </CardHeader>
        {!sent && (
          <CardContent className="space-y-4">
            {mode === 'password' ? (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <Input
                  type="email"
                  placeholder="Имейл"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                <Input
                  type="password"
                  placeholder="Парола"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Вход...' : 'Вход'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <button type="button" onClick={() => { setMode('magiclink'); setError('') }} className="text-blue-600 hover:underline">
                    Вход с magic link
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <Input
                  type="email"
                  placeholder="Имейл"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Изпращане...' : 'Изпрати линк за вход'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <button type="button" onClick={() => { setMode('password'); setError('') }} className="text-blue-600 hover:underline">
                    Вход с парола
                  </button>
                </p>
              </form>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
