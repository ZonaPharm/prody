import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { activeAdminGate } from '@/lib/errors/admin-gate'
import { alertRecipientsSchema } from '@/lib/errors/shape'
import { logAction } from '@/lib/audit'

const bodySchema = z.object({ error_alert_to: alertRecipientsSchema })

/**
 * Who gets the e-mail about new errors, and whether mail can go out at all.
 * The SMTP settings themselves stay on the Имейл tab.
 */
export async function GET() {
  const gate = await activeAdminGate()
  if (!gate.ok) return gate.response
  const { data } = await (createAdminClient().from('email_settings') as any)
    .select('error_alert_to, smtp_host, smtp_pass').eq('id', 1).maybeSingle()
  return NextResponse.json({
    error_alert_to: Array.isArray(data?.error_alert_to) ? data.error_alert_to : [],
    smtp_ready: !!(data?.smtp_host && data?.smtp_pass),
  })
}

export async function PUT(request: NextRequest) {
  const gate = await activeAdminGate()
  if (!gate.ok) return gate.response
  let raw: unknown
  try { raw = await request.json() } catch { return NextResponse.json({ error: 'Невалидни данни' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Проверете имейл адресите' }, { status: 400 })

  const to = [...new Set(parsed.data.error_alert_to.map(s => s.toLowerCase()))]
  const { error } = await (createAdminClient().from('email_settings') as any)
    .update({ error_alert_to: to }).eq('id', 1)
  if (error) {
    console.error('error alert settings save failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Не можа да се запише' }, { status: 500 })
  }
  await logAction({
    action: 'settings_update',
    userId: gate.profile.id,
    userName: gate.profile.display_name,
    details: `Имейл за грешки: ${to.length ? to.join(', ') : 'никой'}`,
  })
  return NextResponse.json({ error_alert_to: to })
}
