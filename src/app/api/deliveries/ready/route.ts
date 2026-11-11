import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { readySchema } from '@/lib/deliveries/schemas'

/**
 * The signed "Етикетиране" checklist: ticked plan rows become ready, the
 * "Не е наред" rows become signals for the admins, in one transaction
 * (mark_ready_checked). The signature is the signed-in account.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response

  const body = await parseBody(request, readySchema)
  if (!body.ok) return body.response
  const { rows, signals } = body.data

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('mark_ready_checked', {
    p_user: gate.user.id,
    p_rows: rows,
    p_signals: signals.map(s => ({
      plan_id: s.plan_id,
      reason: s.reason,
      qty_expected: s.qty_expected ?? null,
      qty_actual: s.qty_actual ?? null,
      note: s.note ?? null,
    })),
  })
  if (error) return rpcFailure('mark_ready_checked', error, 'Етикетирането не мина')

  await logAction({
    action: 'delivery_labelled',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'delivery',
    details: `${data?.ready ?? 0} бр. готови${signals.length ? `, ${signals.length} сигнала` : ''}`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data })
}
