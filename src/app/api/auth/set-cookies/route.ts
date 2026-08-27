import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

export async function POST(request: Request) {
  try {
    const { access_token, refresh_token } = await request.json()
    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: 'missing_tokens' }, { status: 400 })
    }

    // Cookies are written onto this response. Next.js 16 rejects writes through
    // cookies() here, which used to fail silently and leave the browser without
    // an sb-* cookie — proxy.ts then bounced every request back to /login.
    const response = NextResponse.json({ success: true })

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.headers.get('cookie')
              ? request.headers.get('cookie')!.split('; ').map(c => {
                  const i = c.indexOf('=')
                  return { name: c.slice(0, i), value: c.slice(i + 1) }
                })
              : []
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user!.id)
      .returns<{ role: 'admin' | 'seller' }[]>()
      .single()

    const redirectTo = profile?.role === 'admin' ? '/dashboard' : '/record-sale'

    // Carry over only the Set-Cookie headers the auth client wrote above;
    // copying the whole header set would also clone content-type and friends.
    const out = NextResponse.json({ success: true, redirectTo })
    response.cookies.getAll().forEach(c => out.cookies.set(c))
    return out
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
}
