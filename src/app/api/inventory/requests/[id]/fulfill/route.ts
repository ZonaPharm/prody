import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('product_id, store_id, requested_qty, status, notes')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const fulfillNote = 'Изпълнена от администратор'
  const existingNotes = req.notes || ''
  const updatedNotes = existingNotes
    ? `${existingNotes} | ${fulfillNote}`
    : fulfillNote

  const updatePayload: Record<string, any> = {
    status: 'fulfilled',
    updated_at: now,
    notes: updatedNotes,
  }
  try {
    updatePayload.fulfilled_by = user.id
    updatePayload.fulfilled_at = now
  } catch { /* columns may not exist */ }

  await (admin.from('stock_requests') as any)
    .update(updatePayload)
    .eq('id', id)

  // Log event
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id,
      status: 'fulfilled',
      user_id: user.id,
      notes: fulfillNote,
      meta: { fulfilled_by: user.id },
      created_at: now,
    })
  } catch { /* table doesn't exist yet */ }

  await logAction({ action: 'request_fulfill', userId: user.id, entityType: 'stock_request', entityId: id }, supabase)
  return NextResponse.json({ success: true })
}
