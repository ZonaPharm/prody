import { NextRequest, NextResponse } from 'next/server'
import { runBackup } from '@/lib/backup'
import { reportBackupFailure } from '@/lib/backup-alert'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Nightly database backup.
 *
 * Authentication is the Authorization header Vercel sends with its own cron
 * requests, not a query parameter. vercel.json used to carry the secret in the
 * path as ${CRON_SECRET}, which Vercel does not interpolate — it requested that
 * literal string every night from 12 May onwards, this route compared it to the
 * real secret, and returned 401 every time. 117 nights, silently.
 *
 * Reading the header also keeps the secret out of request logs and out of the
 * repository, where the path form put it.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET

  if (!expected) {
    // Never allow an unset secret to mean "open to everyone".
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 })
  }

  const header = request.headers.get('authorization')
  // The query parameter is still accepted so the existing manual trigger and
  // any bookmarked URL keep working.
  const param = new URL(request.url).searchParams.get('secret')

  const authorised = header === `Bearer ${expected}` || param === expected

  if (!authorised) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runBackup()

  // A backup that fails quietly is the reason this went unnoticed for four
  // months. Tell someone.
  if (result.status !== 'ok') {
    await reportBackupFailure(result)
  }

  const statusCode = result.status === 'ok' ? 200 : 500
  return NextResponse.json(result, { status: statusCode })
}
