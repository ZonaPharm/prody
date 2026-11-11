import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { planUpdateSchema } from '@/lib/deliveries/schemas'

/**
 * "Промени плана" on a saved delivery (update_plan). Never below what is
 * already ready for a store, never more than the line in total; a store
 * outside the plan only from the unallocated remainder.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id, itemId } = await params
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: 'Редът не е намерен' }, { status: 404 })

  const body = await parseBody(request, planUpdateSchema)
  if (!body.ok) return body.response

  // The line must belong to the delivery in the URL.
  const { data: item } = await (gate.supabase.from('delivery_items') as any)
    .select('id').eq('id', itemId).eq('delivery_id', id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Редът не е от тази доставка' }, { status: 404 })

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('update_plan', {
    p_item_id: itemId,
    p_user: gate.user.id,
    p_rows: body.data.rows,
  })
  if (error) return rpcFailure('update_plan', error, 'Планът не можа да се промени')
  return NextResponse.json({ success: true })
}
