import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { orderSaveSchema } from '@/lib/supplier-orders/schemas'

/**
 * Save a draft order to a supplier (new or existing), the whole draft in one
 * save_supplier_order call. Admins only, like entering deliveries.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const body = await parseBody(request, orderSaveSchema)
  if (!body.ok) return body.response
  const { id, expected_updated_at, supplier_id, notes, items } = body.data

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('save_supplier_order', {
    p_order_id: id ?? null,
    p_user: gate.user.id,
    p_expected_updated_at: expected_updated_at ?? null,
    p_order: {
      supplier_id,
      notes: notes ?? null,
      items: items.map(i => ({ product_id: i.product_id, quantity: i.quantity, note: i.note ?? null })),
    },
  })
  if (error) return rpcFailure('save_supplier_order', error, 'Поръчката не можа да се запази')
  return NextResponse.json(data)
}
