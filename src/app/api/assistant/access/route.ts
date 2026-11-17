import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasRole } from '@/lib/roles'
import { logAction } from '@/lib/audit'
import { isMissingTableError } from '@/lib/missing-table'
import { assistantConfigured } from '@/lib/assistant/access'
import { monthSpend, monthlyCap } from '@/lib/assistant/store'

/**
 * Настройки → AI → „AI асистент“: who has access, the monthly cap and this
 * month's spend. Admins only. Only an active admin can be given access.
 */
async function signedInAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await (createAdminClient().from('users') as any).select('*').eq('id', user.id).maybeSingle()
  if (!profile || profile.is_active === false || !hasRole(profile, 'admin')) return null
  return { id: user.id as string, name: (profile.display_name || profile.email) as string }
}

const NOT_INSTALLED = 'Таблиците на AI асистента ги няма. Пуснете миграцията 20261113_ai_assistant.sql.'

export async function GET() {
  const me = await signedInAdmin()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = createAdminClient()
  try {
    const [{ data: users }, { data: access, error }, spend, cap] = await Promise.all([
      (db.from('users') as any).select('*').order('display_name'),
      (db.from('ai_assistant_access') as any).select('user_id, granted_at'),
      monthSpend(db),
      monthlyCap(db),
    ])
    if (error) throw error
    const granted = new Map<string, string>((access || []).map((a: any) => [a.user_id, a.granted_at]))
    const admins = (users || [])
      .filter((u: any) => u.is_active !== false && hasRole(u, 'admin'))
      .map((u: any) => ({
        id: u.id,
        name: u.display_name || u.email,
        granted: granted.has(u.id),
        spent_usd: Math.round((spend.byUser.get(u.id) || 0) * 100) / 100,
      }))
    return NextResponse.json({
      configured: assistantConfigured(),
      monthly_cap_usd: cap,
      spent_usd: Math.round(spend.total * 100) / 100,
      admins,
    })
  } catch (err) {
    if (isMissingTableError(err)) return NextResponse.json({ error: NOT_INSTALLED }, { status: 503 })
    throw err
  }
}

const Grant = z.object({ user_id: z.string().uuid(), enabled: z.boolean() })
const Cap = z.object({ monthly_cap_usd: z.number().min(0).max(10000) })

/** Gives or takes away access for one person. */
export async function POST(request: NextRequest) {
  const me = await signedInAdmin()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = Grant.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Грешна заявка' }, { status: 400 })
  const { user_id, enabled } = parsed.data
  const db = createAdminClient()
  const { data: target } = await (db.from('users') as any).select('*').eq('id', user_id).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Няма такъв потребител.' }, { status: 404 })
  if (enabled && (target.is_active === false || !hasRole(target, 'admin'))) {
    return NextResponse.json({ error: 'Достъп може да има само активен администратор.' }, { status: 400 })
  }
  const { error } = enabled
    ? await (db.from('ai_assistant_access') as any).upsert({ user_id, granted_by: me.id }, { onConflict: 'user_id' })
    : await (db.from('ai_assistant_access') as any).delete().eq('user_id', user_id)
  if (error) {
    if (isMissingTableError(error)) return NextResponse.json({ error: NOT_INSTALLED }, { status: 503 })
    return NextResponse.json({ error: 'Записът не успя.' }, { status: 500 })
  }
  await logAction({
    action: enabled ? 'ai_access_granted' : 'ai_access_revoked',
    userId: me.id, userName: me.name, entityType: 'user', entityId: user_id,
    details: `${enabled ? 'Даде' : 'Спря'} достъп до AI асистента на ${target.display_name || target.email}`,
  }, db as any)
  return NextResponse.json({ ok: true })
}

/** Changes the monthly cap. */
export async function PUT(request: NextRequest) {
  const me = await signedInAdmin()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = Cap.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Таванът трябва да е между 0 и 10000 $.' }, { status: 400 })
  const db = createAdminClient()
  const cap = Math.round(parsed.data.monthly_cap_usd * 100) / 100
  const { error } = await (db.from('ai_assistant_settings') as any)
    .upsert({ id: 1, monthly_cap_usd: cap, updated_by: me.id, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) {
    if (isMissingTableError(error)) return NextResponse.json({ error: NOT_INSTALLED }, { status: 503 })
    return NextResponse.json({ error: 'Записът не успя.' }, { status: 500 })
  }
  await logAction({
    action: 'ai_cap_changed', userId: me.id, userName: me.name, entityType: 'settings',
    details: `Месечен таван на AI асистента: ${cap.toFixed(2)} $`,
  }, db as any)
  return NextResponse.json({ ok: true, monthly_cap_usd: cap })
}
