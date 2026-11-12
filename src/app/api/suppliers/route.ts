import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody } from '@/lib/deliveries/api'
import { supplierCreateSchema } from '@/lib/deliveries/schemas'

/** Suppliers belong to the deliveries feature: same gate (admins, switch on). */
export async function GET() {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const { data, error } = await (gate.supabase.from('suppliers') as any)
    .select('id, name, is_active, notes, created_at')
    .order('name')
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const body = await parseBody(request, supplierCreateSchema)
  if (!body.ok) return body.response

  const admin = createAdminClient()
  const { data, error } = await (admin.from('suppliers') as any)
    .insert({ name: body.data.name.replace(/\s+/g, ' '), notes: body.data.notes ?? null })
    .select('id, name, is_active, notes, created_at')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Вече има доставчик с това име' }, { status: 400 })
    console.error('supplier insert failed:', JSON.stringify(error))
    return NextResponse.json({ error: error.message || 'Доставчикът не можа да се добави' }, { status: 500 })
  }

  await logAction({
    action: 'supplier_created',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'supplier',
    entityId: data.id,
    details: data.name,
  }, gate.supabase as any)
  return NextResponse.json(data)
}
