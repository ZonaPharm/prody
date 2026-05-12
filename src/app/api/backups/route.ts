import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: files, error } = await (admin.storage.from('db-backups') as any).list()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const backups = (files || [])
    .filter((f: any) => f.name.startsWith('prody-backup-'))
    .map((f: any) => ({
      name: f.name,
      size: f.metadata?.size || 0,
      created: f.created_at,
    }))
    .sort((a: any, b: any) => b.created.localeCompare(a.created))

  return NextResponse.json({ backups })
}
