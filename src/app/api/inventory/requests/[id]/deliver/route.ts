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

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('id, status').eq('id', id).single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'in_transit') {
    return NextResponse.json({ error: 'Може да доставите само изпратени заявки' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  await (admin.from('stock_requests') as any)
    .update({ status: 'delivered', delivered_at: now, updated_at: now })
    .eq('id', id)

  try {
    await (admin.from('request_events') as any).insert({
      request_id: id, status: 'delivered', user_id: user.id,
      notes: 'Доставена в магазина', created_at: now,
    })
  } catch { /* table may not exist */ }

  await logAction({ action: 'request_deliver', userId: user.id, entityType: 'stock_request', entityId: id }, admin)
  return NextResponse.json({ success: true })
}
