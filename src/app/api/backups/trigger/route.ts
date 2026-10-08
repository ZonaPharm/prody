import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { runBackup } from '@/lib/backup'
import { runIntegrityCheck, integritySummaryHtml, sendIntegrityAlert } from '@/lib/integrity-check'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Same check as the nightly job, so it can be seen working on demand instead
  // of waiting for 3 AM.
  const integrity = await runIntegrityCheck()
  const result = await runBackup(integritySummaryHtml(integrity))
  await sendIntegrityAlert(integrity)

  const statusCode = result.status === 'error' ? 500 : result.status === 'partial' ? 500 : 200
  return NextResponse.json({ ...result, integrity }, { status: statusCode })
}
