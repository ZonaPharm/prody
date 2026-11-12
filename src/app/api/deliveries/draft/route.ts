import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { draftSaveSchema } from '@/lib/deliveries/schemas'

/**
 * Autosave of a draft delivery: the whole draft (header, lines, plan) in one
 * save_delivery_draft call, so a failed write never leaves half a draft.
 * No stock moves while a delivery is a draft.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const body = await parseBody(request, draftSaveSchema)
  if (!body.ok) return body.response
  const { id, expected_updated_at, draft } = body.data

  const admin = createAdminClient()
  const { data, error } = await (admin as any).rpc('save_delivery_draft', {
    p_delivery_id: id ?? null,
    p_user: gate.user.id,
    p_expected_updated_at: expected_updated_at ?? null,
    p_draft: {
      order_ref: draft.order_ref ?? null,
      notes: draft.notes ?? null,
      items: draft.items.map(i => ({
        id: i.id ?? null,
        key: i.key ?? null,
        product_id: i.product_id,
        supplier_id: i.supplier_id ?? null,
        doc_number: i.doc_number ?? null,
        pack_size: i.pack_size,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        needs_label: i.needs_label ?? null,
        plan: i.plan,
      })),
    },
  })

  if (error) return rpcFailure('save_delivery_draft', error, 'Черновата не можа да се запази')
  return NextResponse.json(data)
}
