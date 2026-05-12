import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { runBackup } from '@/lib/backup'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await runBackup()
  const statusCode = result.status === 'error' ? 500 : result.status === 'partial' ? 500 : 200
  return NextResponse.json(result, { status: statusCode })
}
