import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { receiveSchema } from '@/lib/deliveries/schemas'
import { notifyLabelWaiting } from '@/lib/deliveries/notify'

/**
 * The signed receiving checklist. Received units go into Офис and the
 * "Не е наред" rows become signals for the admins, in one transaction
 * (receive_delivery_checked). The signature is the signed-in account.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Доставката не е намерена' }, { status: 404 })

  const body = await parseBody(request, receiveSchema)
  if (!body.ok) return body.response
  const { lines, signals } = body.data

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('receive_delivery_checked', {
    p_delivery_id: id,
    p_user: gate.user.id,
    p_lines: lines,
    p_signals: signals.map(s => ({
      item_id: s.item_id,
      reason: s.reason,
      qty_expected: s.qty_expected ?? null,
      qty_actual: s.qty_actual ?? null,
      note: s.note ?? null,
    })),
  })
  if (error) return rpcFailure('receive_delivery_checked', error, 'Приемането не мина')

  const received = data?.received ?? 0
  // Офис labels: a heads-up on their „Задачи“ (best effort, never fails the receiving).
  await notifyLabelWaiting(admin, id, received)
  await logAction({
    action: 'delivery_received',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'delivery',
    entityId: id,
    details: `${received} бр. в Офис${signals.length ? `, ${signals.length} сигнала` : ''}`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data })
}
