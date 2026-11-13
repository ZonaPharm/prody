import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, rpcFailure } from '@/lib/deliveries/api'
import { formatDeliveryNumber } from '@/lib/deliveries/format'

/** "Запази": the draft becomes "Очаква се" and gets its number (save_delivery). */
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
  return NextResponse.json({ success: true, number })
}
