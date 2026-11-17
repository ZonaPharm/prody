import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, rpcFailure } from '@/lib/deliveries/api'

/**
 * "Пристигна": the order becomes a draft delivery filled from it. The admin then
 * corrects the draft against the invoice (what really came) before saving it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Поръчката не е намерена' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('supplier_order_to_delivery', { p_order_id: id, p_user: gate.user.id })
  if (error) return rpcFailure('supplier_order_to_delivery', error, 'Доставката не можа да се създаде')

  if (data?.created) {
    await logAction({
      action: 'supplier_order_arrived',
      userId: gate.user.id,
      userName: gate.user.display_name,
      entityType: 'supplier_order',
      entityId: id,
      details: `доставка ${data.delivery_id}`,
    }, gate.supabase as any)
  }
  return NextResponse.json(data)
}
