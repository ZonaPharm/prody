import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, isUuid } from '@/lib/deliveries/api'

/** Delete a draft order (never sent, so nobody outside knows of it). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Поръчката не е намерена' }, { status: 404 })

  const admin = createAdminClient()
  const { data, error } = await (admin.from('supplier_orders') as any)
    .delete()
    .eq('id', id)
    .eq('status', 'draft')
    .select('id, number')
  if (error) {
    console.error('supplier order delete failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Черновата не можа да се изтрие' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Само чернова може да се изтрие. Изпратената се отказва.' }, { status: 400 })
  }
  await logAction({
    action: 'supplier_order_deleted',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'supplier_order',
    entityId: id,
    details: `ПР-${String(data[0].number).padStart(6, '0')}`,
  }, gate.supabase as any)
  return NextResponse.json({ ok: true })
}
