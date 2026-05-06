// src/app/(seller)/layout.tsx

import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { SellerLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/record-sale', label: 'Запиши продажба' },
  { href: '/my-sales', label: 'Моите продажби' },
]

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)

  return (
    <SellerLayoutClient
      navItems={navItems}
      displayName={user.display_name}
      isAdminImpersonating={user.role === 'admin' && effectiveRole === 'seller'}
    >
      {children}
    </SellerLayoutClient>
  )
}
