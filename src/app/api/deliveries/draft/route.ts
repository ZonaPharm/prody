import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveriesGate, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { draftSaveSchema } from '@/lib/deliveries/schemas'
import { missingLabelKind } from '@/lib/deliveries/label-kind-compat'

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

  // "Етикет" belongs to the product: written before the draft, so the draft's
  // needs_label (derived from it in the database) is left alone.
  const kinds = new Map<string, string>()
  for (const i of draft.items) if (i.label_kind) kinds.set(i.product_id, i.label_kind)
  // Before the label_kind migration the column is not there: the choice then goes
  // through needs_label as before ("Пълен етикет" = needs a label, anything else = not).
  let kindsWritten = true
  for (const kind of new Set(kinds.values())) {
    const ids = [...kinds].filter(([, k]) => k === kind).map(([p]) => p)
    // A draft has at most a few hundred products, changed ones far fewer: a short .in().
    const { error: e } = await (admin.from('products') as any).update({ label_kind: kind }).in('id', ids).neq('label_kind', kind)
    if (missingLabelKind(e)) { kindsWritten = false; break }
    if (e) return rpcFailure('products.label_kind', e, 'Етикетът на продукта не можа да се запази')
  }

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
        needs_label: i.label_kind ? (kindsWritten ? null : i.label_kind === 'full') : (i.needs_label ?? null),
        plan: i.plan,
      })),
    },
  })

  if (error) return rpcFailure('save_delivery_draft', error, 'Черновата не можа да се запази')
  return NextResponse.json(data)
}
