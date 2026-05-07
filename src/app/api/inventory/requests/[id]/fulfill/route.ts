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

  // Get request details
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('product_id, store_id, requested_qty')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Mark as fulfilled
  const admin = createAdminClient()
  await (admin.from('stock_requests') as any)
    .update({ status: 'fulfilled', updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
