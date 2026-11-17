import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { packSchema } from '@/lib/deliveries/schemas'

/** The signed packing checklist of one shipment (pack_shipment_checked). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Пратката не е намерена' }, { status: 404 })

  const body = await parseBody(request, packSchema)
  if (!body.ok) return body.response
  const { lines, box_count, signals } = body.data

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('pack_shipment_checked', {
    p_shipment_id: id,
    p_user: gate.user.id,
    p_lines: lines,
    p_box_count: box_count,
    p_signals: signals.map(s => ({
      line_id: s.line_id,
      reason: s.reason,
      qty_expected: s.qty_expected ?? null,
      qty_actual: s.qty_actual ?? null,
      note: s.note ?? null,
    })),
  })
  if (error) return rpcFailure('pack_shipment_checked', error, 'Опаковането не мина')

  await logAction({
    action: 'shipment_packed',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'shipment',
    entityId: id,
    details: `${data?.units ?? 0} бр. в ${box_count} кашона${signals.length ? `, ${signals.length} сигнала` : ''}`,
  }, gate.supabase as any)
  return NextResponse.json({ success: true, ...data })
}
