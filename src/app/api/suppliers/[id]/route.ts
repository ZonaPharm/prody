import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid, parseBody } from '@/lib/deliveries/api'
import { supplierUpdateSchema } from '@/lib/deliveries/schemas'

/** Rename, add a note, or switch a supplier off. Suppliers are never deleted: lines point at them. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Доставчикът не е намерен' }, { status: 404 })

  const body = await parseBody(request, supplierUpdateSchema)
  if (!body.ok) return body.response
  const patch: Record<string, unknown> = { ...body.data }
  if (typeof patch.name === 'string') patch.name = (patch.name as string).replace(/\s+/g, ' ')

  const admin = createAdminClient()
  const { data, error } = await (admin.from('suppliers') as any)
    .update(patch)
    .eq('id', id)
    .select('id, name, is_active, notes, created_at')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Вече има доставчик с това име' }, { status: 400 })
    console.error('supplier update failed:', JSON.stringify(error))
    return NextResponse.json({ error: error.message || 'Доставчикът не можа да се промени' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Доставчикът не е намерен' }, { status: 404 })

  await logAction({
    action: 'supplier_updated',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'supplier',
    entityId: id,
    details: JSON.stringify(body.data),
  }, gate.supabase as any)
  return NextResponse.json(data)
}
