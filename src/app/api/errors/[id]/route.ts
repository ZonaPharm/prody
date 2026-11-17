import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { activeAdminGate } from '@/lib/errors/admin-gate'

const bodySchema = z.object({ resolved: z.boolean() })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** „Оправено“ / „Отвори пак“ on one error. Admins only. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await activeAdminGate()
  if (!gate.ok) return gate.response

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Няма такава грешка' }, { status: 404 })
  let raw: unknown
  try { raw = await request.json() } catch { return NextResponse.json({ error: 'Невалидни данни' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Невалидни данни' }, { status: 400 })

  const update = parsed.data.resolved
    ? { resolved_at: new Date().toISOString(), resolved_by: gate.profile.id }
    : { resolved_at: null, resolved_by: null }
  const { data, error } = await (createAdminClient().from('app_errors') as any)
    .update(update).eq('id', id).select('id, resolved_at').maybeSingle()
  if (error) {
    console.error('error resolve failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Не можа да се запише' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Няма такава грешка' }, { status: 404 })
  return NextResponse.json(data)
}
