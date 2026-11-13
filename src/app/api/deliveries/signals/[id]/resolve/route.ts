import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody, rpcFailure } from '@/lib/deliveries/api'
import { resolveSchema } from '@/lib/deliveries/schemas'

/**
 * An admin closes a signal with a decision, signed (resolve_signal). "Намерено"
 * on a store signal puts the missing units back into that store.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Сигналът не е намерен' }, { status: 404 })

  const body = await parseBody(request, resolveSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { error } = await (admin as any).rpc('resolve_signal', {
    p_signal_id: id,
    p_user: gate.user.id,
    p_resolution: body.data.resolution,
    p_note: body.data.note || null,
  })
  if (error) return rpcFailure('resolve_signal', error, 'Сигналът не беше решен')

  await logAction({
    action: 'delivery_signal_resolved',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'delivery_signal',
    entityId: id,
    details: body.data.resolution + (body.data.note ? `: ${body.data.note}` : ''),
  }, gate.supabase as any)
  return NextResponse.json({ success: true })
}
