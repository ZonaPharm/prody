import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody } from '@/lib/deliveries/api'
import { orderSettingsSchema } from '@/lib/supplier-orders/schemas'
import { getOrderSignature } from '@/lib/supplier-orders/doc'
import { mailNotReady } from '@/lib/supplier-orders/email'

/**
 * The signature at the end of every order (company, delivery address, phone) and
 * whether the app's mail is set up. Only this column is read or written here:
 * the SMTP password never leaves the server.
 */
export async function GET() {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const admin = createAdminClient()
  const { data } = await (admin.from('email_settings') as any)
    .select('smtp_host, smtp_port, smtp_user, smtp_pass, sender_email')
    .eq('id', 1)
    .maybeSingle()
  return NextResponse.json({
    order_signature: await getOrderSignature(admin),
    mail_ready: mailNotReady(data) === null,
  })
}

export async function PUT(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const body = await parseBody(request, orderSettingsSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { error } = await (admin.from('email_settings') as any)
    .upsert({ id: 1, order_signature: body.data.order_signature || null })
  if (error) {
    console.error('order signature save failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Подписът не можа да се запази' }, { status: 500 })
  }
  await logAction({
    action: 'settings_update',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'email_settings',
    details: 'подпис на поръчките',
  }, gate.supabase as any)
  return NextResponse.json({ ok: true })
}
