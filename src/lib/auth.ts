import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { homePath } from '@/lib/roles'

export type AppUser = {
  id: string
  email: string
  role: 'admin' | 'seller'
  /** All roles (src/lib/roles.ts); role above is the derived admin/seller. Absent before migration 20261112_user_roles. */
  roles?: string[]
  display_name: string
  store_id: string | null
}

export async function requireAuth(): Promise<AppUser> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  // A deactivated account is also banned in Supabase Auth, but a session it
  // already holds stays valid until the token expires. Turn it away here.
  if ((profile as any).is_active === false) redirect('/auth/signout')
  return profile as AppUser
}

export async function getEffectiveRole(user: AppUser): Promise<'admin' | 'seller'> {
  if (user.role !== 'admin') return user.role
  const cookieStore = await cookies()
  const viewAs = cookieStore.get('prody_view_as')?.value
  if (viewAs === 'seller') return 'seller'
  return 'admin'
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireAuth()
  // Not an admin at all (a seller, Офис, a driver): their own start page.
  if (user.role !== 'admin') redirect(homePath(user))
  const effectiveRole = await getEffectiveRole(user)
  if (effectiveRole !== 'admin') redirect('/record-sale')
  return user
}
