import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody } from '@/lib/deliveries/api'
import { notificationsReadSchema } from '@/lib/deliveries/schemas'

/**
 * Marks the signed-in person's notifications as read: the ones listed, or all
 * of them. Signed-in users may only read the table (RLS), so the write goes
 * through here, always limited to their own rows.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await parseBody(request, notificationsReadSchema)
  if (!body.ok) return body.response

  if (body.data.ids && body.data.ids.length === 0) return NextResponse.json({ success: true })

  const admin = createAdminClient()
  let q = (admin.from('notifications') as any)
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
  if (body.data.ids) q = q.in('id', body.data.ids)
  const { error } = await q
  if (error) {
    console.error('notifications read failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Не успях да отбележа известията' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
