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

  // Only the seller who made the request (or admin) can confirm
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('store_id, status')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'fulfilled') {
    return NextResponse.json({ error: 'Заявката не е изпълнена все още' }, { status: 400 })
  }

  const admin = createAdminClient()
  await (admin.from('stock_requests') as any)
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
