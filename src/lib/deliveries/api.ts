import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { deliveriesEnabledFor } from './feature'
import { firstIssue } from './schemas'
import { rpcErrorResponse, type RpcErrorLike } from '@/lib/rpc-error'
import type { z } from 'zod'

/**
 * The gate every delivery API route passes first:
 * 401 without a session, 403 for a seller or a deactivated account,
 * 404 while the feature switch is off for this admin (as if the route did not exist).
 */

export type DeliveriesUser = { id: string; email: string; display_name: string }

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>

export type Gate =
  | { ok: true; user: DeliveriesUser; supabase: Supabase }
  | { ok: false; response: NextResponse }

export async function deliveriesGate(): Promise<Gate> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await (supabase.from('users') as any)
    .select('id, email, role, display_name, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin' || profile.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!deliveriesEnabledFor(profile.email)) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  return {
    ok: true,
    user: { id: profile.id, email: profile.email, display_name: profile.display_name },
    supabase,
  }
}

/** Parse a JSON body with a schema; a 400 with the first problem in Bulgarian otherwise. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Невалидни данни' }, { status: 400 }) }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 }) }
  }
  return { ok: true, data: parsed.data }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Route params arrive as text; anything that is not a uuid is "not found", not a database error. */
export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value)
}

/** The answer for a failed database function call (see rpc-error.ts). */
export function rpcFailure(fn: string, error: unknown, fallback: string): NextResponse {
  const { status, error: message } = rpcErrorResponse(error as RpcErrorLike, fallback)
  if (status === 500) console.error(`${fn} failed:`, JSON.stringify(error))
  return NextResponse.json({ error: message }, { status })
}
