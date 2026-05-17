import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20)

  if (q.length < 2) return NextResponse.json([])

  const { data } = await (supabase.from('products') as any)
    .select('id, name, barcode')
    .or(`name.ilike.*${q}*,barcode.ilike.*${q}*`)
    .eq('is_active', true)
    .order('name')
    .limit(limit)

  return NextResponse.json(data || [])
}
