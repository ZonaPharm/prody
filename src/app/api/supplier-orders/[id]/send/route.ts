import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { orderSendSchema } from '@/lib/supplier-orders/schemas'
import { getOrderDetail } from '@/lib/supplier-orders/queries'
import { orderDocFrom } from '@/lib/supplier-orders/doc'
import { mailNotReady, sendOrderEmail } from '@/lib/supplier-orders/email'
import { formatOrderNumber } from '@/lib/supplier-orders/format'

/**
 * Send the order. via 'email': to the supplier's order addresses, then it is
 * marked sent (only when the e-mail left). via 'manual': it was ordered by phone,
 * Viber or on paper; only marked.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Поръчката не е намерена' }, { status: 404 })

  const body = await parseBody(request, orderSendSchema)
  if (!body.ok) return body.response
  const { via } = body.data

  const admin = createAdminClient()
  const order = await getOrderDetail(admin, id)
  if (!order) return NextResponse.json({ error: 'Поръчката не е намерена' }, { status: 404 })
  if (order.status !== 'draft' && order.status !== 'sent') {
    return NextResponse.json({ error: order.status === 'received' ? 'Поръчката вече е пристигнала' : 'Поръчката е отказана' }, { status: 400 })
  }
  if (order.lines.length === 0) {
    return NextResponse.json({ error: 'Поръчката е празна: добавете поне един продукт' }, { status: 400 })
  }

  let to: string[] = []
  if (via === 'email') {
    to = order.supplier.order_emails
    if (to.length === 0) {
      return NextResponse.json({ error: `${order.supplier.name} няма имейл за поръчки. Добавете го в Настройки → Доставчици.` }, { status: 400 })
    }
    const { data: settings } = await (admin.from('email_settings') as any)
      .select('smtp_host, smtp_port, smtp_user, smtp_pass, sender_email, order_signature')
      .eq('id', 1)
      .maybeSingle()
    const notReady = mailNotReady(settings)
    if (notReady) return NextResponse.json({ error: notReady }, { status: 400 })
    try {
      await sendOrderEmail(settings, orderDocFrom(order, settings.order_signature ?? null, gate.user.display_name), to, {
        email: gate.user.email,
        name: gate.user.display_name,
      })
    } catch (e: any) {
      console.error('supplier order e-mail failed:', e?.message ?? e)
      return NextResponse.json({
        error: `Имейлът не тръгна (${e?.message ?? 'грешка в пощата'}). Поръчката не е отбелязана като изпратена.`,
      }, { status: 502 })
    }
  }

  const { data, error } = await (admin as any).rpc('send_supplier_order', {
    p_order_id: id,
    p_user: gate.user.id,
    p_via: via,
    p_to: via === 'email' ? to : null,
  })
  if (error) return rpcFailure('send_supplier_order', error, 'Поръчката не можа да се отбележи като изпратена')

  await logAction({
    action: 'supplier_order_sent',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'supplier_order',
    entityId: id,
    details: `${formatOrderNumber(order.number)} → ${order.supplier.name}${via === 'email' ? ` (${to.join(', ')})` : ' (сам)'}`,
  }, gate.supabase as any)
  return NextResponse.json({ ...data, to })
}
