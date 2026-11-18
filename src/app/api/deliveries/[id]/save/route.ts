import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, rpcFailure } from '@/lib/deliveries/api'
import { formatDeliveryNumber } from '@/lib/deliveries/format'
import { notifyLabelWaiting } from '@/lib/deliveries/notify'
import { rpcErrorResponse, type RpcErrorLike } from '@/lib/rpc-error'
import { receiveAllLines } from '@/lib/deliveries/receive'

/**
 * "Запиши и приеми": the draft gets its number (save_delivery) and everything
 * typed in goes into Офис right away (receive_delivery_checked with every line
 * in full). The person enters what arrived, so entering it is receiving it:
 * there is no separate "Получаване" step for a new delivery.
 *
 * Two database calls, each one transaction. If the receiving one fails, the
 * delivery stays "Очаква се" with nothing moved, and the answer says so
 * (received: 0, receive_error): the screen then opens "Получаване" for it,
 * which still works as before.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Доставката не е намерена' }, { status: 404 })

  const admin = createAdminClient()
  const { data: number, error } = await (admin as any).rpc('save_delivery', { p_delivery_id: id, p_user: gate.user.id })
  if (error) return rpcFailure('save_delivery', error, 'Доставката не можа да се запише')

  await logAction({
    action: 'delivery_saved',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'delivery',
    entityId: id,
    details: formatDeliveryNumber(number),
  }, gate.supabase as any)

  const receiveFailed = (e: unknown) => {
    console.error('receive after save failed:', JSON.stringify(e))
    const { error: message } = rpcErrorResponse(e as RpcErrorLike, 'Приемането не мина')
    return NextResponse.json({ success: true, number, received: 0, receive_error: message })
  }

  const { data: items, error: itemsError } = await (admin as any)
    .from('delivery_items')
    .select('id, quantity, received_qty')
    .eq('delivery_id', id)
  if (itemsError) return receiveFailed(itemsError)

  const lines = receiveAllLines(items ?? [])
  if (lines.length === 0) return NextResponse.json({ success: true, number, received: 0 })

  const { data, error: receiveError } = await (admin as any).rpc('receive_delivery_checked', {
    p_delivery_id: id,
    p_user: gate.user.id,
    p_lines: lines,
    p_signals: [],
  })
  if (receiveError) return receiveFailed(receiveError)

  const received = data?.received ?? 0
  // Офис labels: a heads-up on their „Задачи“ (best effort, never fails the receiving).
  await notifyLabelWaiting(admin, id, received)
  await logAction({
    action: 'delivery_received',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'delivery',
    entityId: id,
    details: `${received} бр. в Офис, при въвеждането`,
  }, gate.supabase as any)

  return NextResponse.json({ success: true, number, received, auto_ready: data?.auto_ready ?? 0 })
}
