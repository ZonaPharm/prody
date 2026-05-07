import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('product_id, store_id, requested_qty, status')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createAdminClient()
  const now = new Date().toISOString()
  await (admin.from('stock_requests') as any)
    .update({ status: 'fulfilled', updated_at: now })
    .eq('id', id)

  // Log event (if table exists)
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id,
      status: 'fulfilled',
      user_id: user.id,
      notes: 'Заявката е изпълнена',
      meta: { fulfilled_by: user.id },
      created_at: now,
    })
  } catch { /* table doesn't exist yet */ }

  return NextResponse.json({ success: true })
}
