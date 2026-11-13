/**
 * Who may use the AI assistant: an active Администратор whose name an admin
 * ticked in Настройки → AI. Checked on the server on every request, from the
 * database, never from anything the browser sends.
 *
 * Only admins, because the assistant sees sales and every log, and Офис must
 * not see sales (decision 2026-11-12).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { hasRole } from '@/lib/roles'
import { isMissingTableError } from '@/lib/missing-table'

export type AssistantUser = { id: string; name: string }

export type AccessResult =
  | { ok: true; user: AssistantUser }
  | { ok: false; status: 401 | 403 | 503; error: string }

/** Pure part of the check (tested): may this users row use the assistant, given the access row? */
export function mayUseAssistant(profile: { role?: unknown; roles?: unknown; is_active?: unknown } | null, granted: boolean): boolean {
  if (!profile || profile.is_active === false) return false
  return hasRole(profile, 'admin') && granted
}

export async function isGranted(userId: string): Promise<boolean> {
  const { data, error } = await (createAdminClient().from('ai_assistant_access') as any)
    .select('user_id').eq('user_id', userId).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return false
    throw error
  }
  return !!data
}

/** For API routes: the signed-in person, if they may use the assistant. */
export async function assistantAccess(): Promise<AccessResult> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Не сте влезли.' }
  const { data: profile } = await (createAdminClient().from('users') as any)
    .select('*').eq('id', user.id).maybeSingle()
  const granted = profile ? await isGranted(user.id) : false
  if (!mayUseAssistant(profile, granted)) return { ok: false, status: 403, error: 'Нямате достъп до AI асистента.' }
  return { ok: true, user: { id: user.id, name: profile.display_name || profile.email } }
}

export function assistantConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}
