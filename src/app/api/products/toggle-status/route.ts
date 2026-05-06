import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { product_id, status } = await request.json()
  if (!product_id || !['active', 'inactive'].includes(status)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { error } = await (supabase.from('products') as any)
    .update({ status, inactive_reason: status === 'active' ? null : undefined })
    .eq('id', product_id)

  if (error) {
    return NextResponse.json({ error: 'Грешка при обновяване' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status })
}
