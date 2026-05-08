import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') || 'action'
  const action = searchParams.get('action')
  const userId = searchParams.get('user_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') || '200')

  let query = (supabase.from('audit_logs') as any).select('*').order('created_at', { ascending: false }).limit(limit)
  if (type && type !== '__all__') query = query.eq('type', type)
  if (action && action !== '__all__') query = query.eq('action', action)
  if (userId) query = query.eq('user_id', userId)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data } = await query
  return NextResponse.json(data || [])
}
