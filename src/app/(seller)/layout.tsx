// src/app/(seller)/layout.tsx

import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SellerLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/record-sale', label: 'Запиши продажба' },
  { href: '/my-sales', label: 'Моите продажби' },
  { href: '/my-requests', label: 'Заявки' },
]

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()

  // Count requests waiting for seller confirmation (delivered)
  let requestBadge = 0
  try {
    const { count } = await (supabase.from('stock_requests') as any)
      .select('*', { count: 'exact', head: true })
      .eq('requested_by', user.id)
      .eq('status', 'delivered')
    requestBadge = count || 0
  } catch {}

  return (
    <SellerLayoutClient
      navItems={navItems}
      displayName={user.display_name}
      isAdminImpersonating={user.role === 'admin' && effectiveRole === 'seller'}
      requestBadge={requestBadge}
    >
      {children}
    </SellerLayoutClient>
  )
}
