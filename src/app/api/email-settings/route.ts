import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit'
import { emailSettingsSchema, emailSettingsUpdate, publicEmailSettings } from '@/lib/email-settings'

/**
 * Настройки → Имейл. Only an active admin reads or changes the mail settings,
 * and the SMTP password never leaves the server (see src/lib/email-settings.ts).
 */
async function activeAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await (supabase.from('users') as any)
    .select('role, is_active, display_name')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin' || profile.is_active === false) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true as const, supabase, user, profile }
}

export async function GET() {
  const gate = await activeAdmin()
  if (!gate.ok) return gate.response

  const { data } = await (gate.supabase.from('email_settings') as any).select('*').eq('id', 1).single()
  return NextResponse.json(publicEmailSettings(data))
}

export async function POST(request: NextRequest) {
  const gate = await activeAdmin()
  if (!gate.ok) return gate.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Невалидни данни' }, { status: 400 })
  }
  const parsed = emailSettingsSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Проверете полетата: ' + (parsed.error.issues[0]?.path.join('.') || '') }, { status: 400 })
  }

  const { data, error } = await (gate.supabase.from('email_settings') as any)
    .upsert({ id: 1, ...emailSettingsUpdate(parsed.data), updated_at: new Date().toISOString() })
    .select('*')
    .single()

  if (error) {
    console.error('email settings save failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Настройките не можаха да се запазят' }, { status: 500 })
  }
  await logAction({
    action: 'settings_update',
    userId: gate.user.id,
    userName: gate.profile.display_name,
    entityType: 'email_settings',
  }, gate.supabase)
  return NextResponse.json(publicEmailSettings(data))
}
