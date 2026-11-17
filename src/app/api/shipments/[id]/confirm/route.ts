import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { confirmSchema } from '@/lib/deliveries/schemas'
import { formatShipmentNumber } from '@/lib/deliveries/format'
import { notifyShipmentIssue } from '@/lib/deliveries/notify'

/**
 * The store's checklist for a shipment that arrived (confirm_shipment). Any
 * active account may call it; the database lets through only a user of the
 * shipment's store or an admin. Short lines become signals and the missing
 * units leave the store until an admin decides.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!deliveriesActive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await (supabase.from('users') as any)
    .select('id, display_name, role, store_id, is_active')
    .eq('id', user.id)
    .single()
  if (!profile || profile.is_active === false) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Пратката не е намерена' }, { status: 404 })

  const body = await parseBody(request, confirmSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('confirm_shipment', {
    p_shipment_id: id,
    p_user: profile.id,
    p_lines: body.data.lines.map(l => ({
      line_id: l.line_id,
      received_qty: l.received_qty,
      reason: l.reason ?? null,
      note: l.note ?? null,
    })),
  })
  if (error) return rpcFailure('confirm_shipment', error, 'Потвърждението не мина')
  await notifyShipmentIssue(admin, id, Number(data?.signals ?? 0))

  const { data: ship } = await (admin.from('shipments') as any).select('number').eq('id', id).maybeSingle()
  await logAction({
    action: 'shipment_received',
    userId: profile.id,
    userName: profile.display_name,
    entityType: 'shipment',
    entityId: id,
    details: `${formatShipmentNumber(ship?.number)}${data?.signals ? `, ${data.signals} сигнала` : ''}`,
  }, supabase as any)
  return NextResponse.json({ success: true, ...data })
}
