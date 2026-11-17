import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { homePath } from '@/lib/roles'

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
    // '*': before migration 20261112_user_roles there is no roles column.
    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user!.id)
      .returns<{ role: 'admin' | 'seller'; roles?: string[] }[]>()
      .single()
    const redirectTo = homePath(profile)
    return NextResponse.json({ success: true, redirectTo })
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
}
