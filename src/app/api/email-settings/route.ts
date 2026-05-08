import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await (supabase.from('email_settings') as any).select('*').eq('id', 1).single()
  return NextResponse.json(data || {})
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { data, error } = await (supabase.from('email_settings') as any)
    .upsert({ id: 1, ...body, updated_at: new Date().toISOString() })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  logAction({ action: 'settings_update', userId: user.id, entityType: 'email_settings' }).catch(() => {})
  return NextResponse.json(data)
}
