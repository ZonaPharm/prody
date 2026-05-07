import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

// Secret key for generating one-time login tokens
const LOGIN_SECRET = process.env.LOGIN_SECRET || 'prody-login-secret-2026'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  // Simple HMAC-like verification
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(LOGIN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expectedBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(email || ''))
  const expected = Array.from(new Uint8Array(expectedBytes)).map(b => b.toString(16).padStart(2, '0')).join('')

  if (token !== expected.slice(0, 32)) {
    return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 })
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Generate a magic link — but now we handle the redirect ourselves
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${request.nextUrl.origin}/dashboard` },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // The magic link goes through Supabase's verify endpoint which will create the session
  // Since the user exists and has confirmed email, this should work
  return NextResponse.redirect(data.properties?.action_link || '/login')
}
