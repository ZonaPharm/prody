import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody } from '@/lib/deliveries/api'
import { PROFILE_COLUMNS, layoutToRow, profileFromRow, profileUpdateSchema } from '@/lib/labels/profiles'

const NOT_FOUND = () => NextResponse.json({ error: 'Профилът не е намерен' }, { status: 404 })

/** Rename a profile or change its sizes and offsets. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NOT_FOUND()
  const body = await parseBody(request, profileUpdateSchema)
  if (!body.ok) return body.response

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.data.name !== undefined) patch.name = body.data.name
  if (body.data.layout) Object.assign(patch, layoutToRow(body.data.layout))

  const admin = createAdminClient()
  const { data, error } = await (admin.from('label_sheet_profiles') as any)
    .update(patch)
    .eq('id', id)
    .select(PROFILE_COLUMNS)
    .maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Вече има профил с това име' }, { status: 400 })
    console.error('label profile update failed:', JSON.stringify(error))
    return NextResponse.json({ error: error.message || 'Профилът не можа да се промени' }, { status: 500 })
  }
  if (!data) return NOT_FOUND()
  await logAction({
    action: 'label_profile_updated',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'label_profile',
    entityId: id,
    details: JSON.stringify(body.data),
  }, gate.supabase as any)
  return NextResponse.json(profileFromRow(data))
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NOT_FOUND()

  const admin = createAdminClient()
  const { data, error } = await (admin.from('label_sheet_profiles') as any)
    .delete()
    .eq('id', id)
    .select('id, name')
    .maybeSingle()
  if (error) {
    console.error('label profile delete failed:', JSON.stringify(error))
    return NextResponse.json({ error: error.message || 'Профилът не можа да се изтрие' }, { status: 500 })
  }
  if (!data) return NOT_FOUND()
  await logAction({
    action: 'label_profile_deleted',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'label_profile',
    entityId: id,
    details: data.name,
  }, gate.supabase as any)
  return NextResponse.json({ ok: true })
}
