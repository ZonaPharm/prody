import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { assistantAccess } from '@/lib/assistant/access'
import { deliveriesEnabledFor } from '@/lib/deliveries/feature'
import { cardOf, ownAction } from '@/lib/assistant/store'
import { confirmSchemas, execute, isConfirmable, withinProposal } from '@/lib/assistant/execute'

export const dynamic = 'force-dynamic'

const Body = z.object({
  decision: z.enum(['confirm', 'dismiss']),
  /** The card as the person left it (edited quantities, prices, rows). */
  payload: z.unknown().optional(),
})

/**
 * The person's answer to a card: "confirm" carries the proposal out, "dismiss"
 * puts it aside. Only the person the card was made for, only once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Няма такова предложение.' }, { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Грешна заявка' }, { status: 400 })

  const db = createAdminClient()
  const action = await ownAction(db, access.user.id, id)
  if (!action) return NextResponse.json({ error: 'Няма такова предложение.' }, { status: 404 })
  if (action.status !== 'proposed' || !isConfirmable(action.kind)) {
    return NextResponse.json({ error: 'Това предложение вече е решено.', card: cardOf(action) }, { status: 409 })
  }
  const kind = action.kind

  // Claim it first, so a double press cannot carry it out twice.
  const now = new Date().toISOString()
  const status = parsed.data.decision === 'confirm' ? 'done' : 'dismissed'
  const { data: claimed } = await (db.from('ai_actions') as any)
    .update({ status, done_at: now, done_by: access.user.id }).eq('id', id).eq('status', 'proposed').select('id')
  if (!claimed?.length) return NextResponse.json({ error: 'Това предложение вече е решено.' }, { status: 409 })
  const release = () => (db.from('ai_actions') as any).update({ status: 'proposed', done_at: null, done_by: null }).eq('id', id)

  if (status === 'dismissed') {
    return NextResponse.json({ card: { ...cardOf(action), status } })
  }

  if ((kind === 'delivery_draft' || kind === 'supplier_order') && !deliveriesEnabledFor(access.user.email)) {
    await release()
    return NextResponse.json({ error: 'Доставките и поръчките не са включени за Вас.' }, { status: 403 })
  }
  const edited = confirmSchemas[kind].safeParse(parsed.data.payload ?? action.payload)
  const problem = edited.success ? withinProposal(kind, action.payload, edited.data) : edited.error.issues[0]?.message || 'Грешни данни'
  if (problem) {
    await release()
    return NextResponse.json({ error: problem }, { status: 400 })
  }

  let outcome
  try {
    outcome = await execute(db, { id: access.user.id, name: access.user.name }, action, kind, edited.data)
  } catch (err) {
    console.error('assistant action failed:', err)
    outcome = { ok: false as const, error: 'Нещо се обърка при записа. Опитайте пак.' }
  }
  if (!outcome.ok) {
    if (outcome.proposal) await (db.from('ai_actions') as any).update({ payload: outcome.proposal }).eq('id', id)
    await release()
    return NextResponse.json({ error: outcome.error, card: outcome.proposal ? { ...cardOf(action), payload: outcome.proposal } : undefined }, { status: 400 })
  }
  const { error } = await (db.from('ai_actions') as any).update({ result: outcome.result, payload: edited.data && { ...action.payload, confirmed: edited.data } }).eq('id', id)
  if (error) console.error('ai_actions result not stored:', JSON.stringify(error))
  return NextResponse.json({ card: { ...cardOf(action), status, result: outcome.result } })
}
