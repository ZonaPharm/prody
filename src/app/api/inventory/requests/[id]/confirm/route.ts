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
  const body = await request.json().catch(() => ({}))
  const { received_qty, notes } = body

  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('store_id, status, requested_qty, notes')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'fulfilled') {
    return NextResponse.json({ error: 'Заявката не е изпълнена все още' }, { status: 400 })
  }

  const admin = createAdminClient()
  const actualQty = received_qty ?? req.requested_qty
  const isPartial = actualQty < req.requested_qty
  const status = isPartial ? 'partial' : 'confirmed'

  // Build timeline note
  const confirmNote = notes || (isPartial
    ? `Получени ${actualQty} от ${req.requested_qty} бр.`
    : `Потвърдено получаване на ${req.requested_qty} бр.`)

  // Append confirm note to existing notes
  const existingNotes = req.notes || ''
  const updatedNotes = existingNotes
    ? `${existingNotes} | ${confirmNote}`
    : confirmNote

  // Store received_qty as a structured suffix in notes for display
  const notesWithMeta = `${updatedNotes} {{received:${actualQty}}}`

  const updatePayload: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
    notes: notesWithMeta,
  }
  // received_qty column may not exist yet (migration pending)
  try {
    updatePayload.received_qty = actualQty
  } catch { /* ignore */ }

  await (admin.from('stock_requests') as any)
    .update(updatePayload)
    .eq('id', id)

  // Log event
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id,
      status,
      user_id: user.id,
      notes: confirmNote,
      meta: { received_qty: actualQty, requested_qty: req.requested_qty },
      created_at: new Date().toISOString(),
    })
  } catch { /* table doesn't exist yet */ }

  await logAction({ action: 'request_confirm', userId: user.id, entityType: 'stock_request', entityId: id, details: `Статус: ${status}` }, supabase)
  return NextResponse.json({ success: true, status, received_qty: actualQty })
}
