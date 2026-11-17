import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

/** Настройки → Грешки: only an active admin reads errors or changes who is told. */
export async function activeAdminGate() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await (supabase.from('users') as any)
    .select('id, role, is_active, display_name')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin' || profile.is_active === false) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true as const, user, profile }
}
