import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, rpcFailure } from '@/lib/deliveries/api'

/** "Отвори опаковането": a packed shipment goes back to packing, to be packed and signed again. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Пратката не е намерена' }, { status: 404 })

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('reopen_packing', { p_shipment_id: id, p_user: gate.user.id })
  if (error) return rpcFailure('reopen_packing', error, 'Опаковането не беше отворено')

  await logAction({
    action: 'shipment_unpacked',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'shipment',
    entityId: id,
  }, gate.supabase as any)
  return NextResponse.json({ success: true })
}
