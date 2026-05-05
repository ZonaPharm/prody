import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { access_token, refresh_token } = await request.json()
    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: 'missing_tokens' }, { status: 400 })
    }
    const supabase = await createServerSupabaseClient()
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
    return NextResponse.json({ success: true, redirectTo })
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
}
