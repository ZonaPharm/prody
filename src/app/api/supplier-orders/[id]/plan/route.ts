import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { orderPlanSaveSchema } from '@/lib/supplier-orders/schemas'

/**
 * Change only the split per store of an order, also after it was sent: the
 * supplier never sees it, so it may change until the goods arrive. Then it is
 * changed in the delivery.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Поръчката не е намерена' }, { status: 404 })

  const body = await parseBody(request, orderPlanSaveSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('save_supplier_order_plan', {
    p_order_id: id,
    p_user: gate.user.id,
    p_expected_updated_at: body.data.expected_updated_at ?? null,
    p_items: body.data.items.map(i => ({ product_id: i.product_id, plan: i.plan })),
  })
  if (error) return rpcFailure('save_supplier_order_plan', error, 'Разпределението не можа да се запази')

  await logAction({
    action: 'supplier_order_plan_changed',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'supplier_order',
    entityId: id,
    details: `${body.data.items.length} ${body.data.items.length === 1 ? 'ред' : 'реда'}`,
  }, gate.supabase as any)
  return NextResponse.json(data)
}
