import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody } from '@/lib/deliveries/api'
import { PROFILE_COLUMNS, layoutToRow, profileCreateSchema, profileFromRow } from '@/lib/labels/profiles'

/** Label paper profiles, for the label print page of the deliveries (same gate). */
export async function GET() {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const { data, error } = await (gate.supabase.from('label_sheet_profiles') as any)
    .select(PROFILE_COLUMNS)
    .order('name')
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []).map(profileFromRow))
}

export async function POST(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const body = await parseBody(request, profileCreateSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin.from('label_sheet_profiles') as any)
    .insert({ name: body.data.name, ...layoutToRow(body.data.layout), created_by: gate.user.id })
    .select(PROFILE_COLUMNS)
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Вече има профил с това име' }, { status: 400 })
    console.error('label profile insert failed:', JSON.stringify(error))
    return NextResponse.json({ error: error.message || 'Профилът не можа да се запази' }, { status: 500 })
  }
  await logAction({
    action: 'label_profile_created',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'label_profile',
    entityId: data.id,
    details: data.name,
  }, gate.supabase as any)
  return NextResponse.json(profileFromRow(data))
}
