import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { browserErrorSchema } from '@/lib/errors/shape'
import { recordError } from '@/lib/errors/server'
import { activeAdminGate } from '@/lib/errors/admin-gate'

/**
 * POST: the browser reports an error (src/lib/errors/client.ts). Any signed-in
 * user may, because the errors that matter most happen at the till. The user
 * is taken from the session, never from the body.
 *
 * GET: the list for Настройки → Грешки. Admins only.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })

  let raw: unknown
  try { raw = await request.json() } catch { return new NextResponse(null, { status: 400 }) }
  const parsed = browserErrorSchema.safeParse(raw)
  if (!parsed.success) return new NextResponse(null, { status: 400 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('display_name, email').eq('id', user.id).maybeSingle()

  await recordError({
    source: 'browser',
    kind: parsed.data.kind,
    message: parsed.data.message,
    stack: parsed.data.stack,
    path: parsed.data.path,
    digest: parsed.data.digest,
    userId: user.id,
    userName: profile?.display_name || profile?.email || user.email || null,
    userAgent: request.headers.get('user-agent'),
  })
  return new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  const gate = await activeAdminGate()
  if (!gate.ok) return gate.response

  const status = new URL(request.url).searchParams.get('status') === 'all' ? 'all' : 'open'
  const admin = createAdminClient()
  let query = (admin.from('app_errors') as any)
    .select('id, source, kind, message, stack, path, method, digest, release, user_name, user_agent, count, first_seen, last_seen, resolved_at, notified_at')
    .order('last_seen', { ascending: false })
    .limit(200)
  if (status === 'open') query = query.is('resolved_at', null)
  const { data, error } = await query
  if (error) {
    console.error('errors list failed:', JSON.stringify(error))
    return NextResponse.json({ error: 'Грешките не можаха да се заредят' }, { status: 500 })
  }
  return NextResponse.json(data || [])
}
