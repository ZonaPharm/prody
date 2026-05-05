import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { RoleRouter } from './role-router'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Server has session via cookies → redirect to appropriate page
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .returns<{ role: 'admin' | 'seller' }[]>()
      .single()

    return redirect(profile?.role === 'admin' ? '/dashboard' : '/record-sale')
  }

  // No cookies → render client-side handler for hash-fragment fallback
  return <RoleRouter />
}
