import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', origin))
  }
  try {
    const supabase = await createServerSupabaseClient()
    await supabase.auth.exchangeCodeForSession(code)
    return NextResponse.redirect(new URL('/', origin))
  } catch {
    return NextResponse.redirect(new URL('/login?error=auth_callback_failed', origin))
  }
}
