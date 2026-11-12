import { createClient } from '@supabase/supabase-js'

/**
 * The driver signs for the boxes with their own password, typed on the screen
 * in Офис (decision: every person has their own account, the driver included).
 * The password is checked against Supabase Auth with a throw-away client that
 * keeps no session and sets no cookie, so the admin at the keyboard stays
 * signed in as themselves. The session the check opens is closed again
 * (scope 'local': the driver's own logins elsewhere are untouched).
 *
 * Returns true only when the e-mail and password belong to the expected user.
 */
export async function verifyDriverPassword(userId: string, email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key || !email || !password) return false
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data?.user) return false
  const ok = data.user.id === userId
  try {
    await client.auth.signOut({ scope: 'local' })
  } catch {
    // The check is done; a failed sign-out only leaves an unused refresh token.
  }
  return ok
}
