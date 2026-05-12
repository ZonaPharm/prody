import { NextRequest, NextResponse } from 'next/server'
import { runBackup } from '@/lib/backup'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runBackup()
  const statusCode = result.status === 'error' ? 500 : result.status === 'partial' ? 500 : 200
  return NextResponse.json(result, { status: statusCode })
}
