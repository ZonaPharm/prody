import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data } = await (supabase.from('request_notes') as any)
    .select('id, body, user_id, created_at, user:users(display_name)')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json((data || []).map((n: any) => ({
    id: n.id,
    body: n.body,
    user_id: n.user_id,
    user_name: Array.isArray(n.user) ? n.user[0]?.display_name : n.user?.display_name,
    created_at: n.created_at,
  })))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { body } = await request.json()
  if (!body || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'Коментарът е задължителен' }, { status: 400 })
  }

  const { data: profile } = await (supabase.from('users') as any)
    .select('display_name').eq('id', user.id).single()

  const { data: note, error } = await (supabase.from('request_notes') as any)
    .insert({ request_id: id, user_id: user.id, body: body.trim() })
    .select('id, body, user_id, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ...note,
    user_name: profile?.display_name || user.email,
  })
}
