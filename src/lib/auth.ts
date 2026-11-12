import { cache } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export type AppUser = {
  id: string
  email: string
  role: 'admin' | 'seller'
  display_name: string
  store_id: string | null
}

// The layout and the page both ask who is signed in, and each answer is two
// round trips (Supabase Auth, then public.users). cache() gives every caller in
// one request the same answer, so a page load asks once.
export const requireAuth = cache(async function requireAuth(): Promise<AppUser> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  return profile as AppUser
})

export async function getEffectiveRole(user: AppUser): Promise<'admin' | 'seller'> {
  if (user.role !== 'admin') return user.role
  const cookieStore = await cookies()
  const viewAs = cookieStore.get('prody_view_as')?.value
  if (viewAs === 'seller') return 'seller'
  return 'admin'
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  if (effectiveRole !== 'admin') redirect('/record-sale')
  return user
}
