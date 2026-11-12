'use client'

import { AppShell, type ShellNavItem } from '@/components/layout/app-shell'

interface NavItem {
  href: string
  label: string
}

const SHORT: Record<string, string> = {
  '/record-sale': 'Продажба',
  '/my-sales': 'Продажби',
  '/my-requests': 'Заявки',
  '/my-shipments': 'Пратки',
}

export function SellerLayoutClient({
  navItems,
  displayName,
  isAdminImpersonating,
  children,
  requestBadge,
  shipmentBadge,
}: {
  navItems: NavItem[]
  displayName: string
  isAdminImpersonating: boolean
  children: React.ReactNode
  requestBadge?: number
  shipmentBadge?: number
}) {
  const items: ShellNavItem[] = navItems.map(item => ({
    ...item,
    short: SHORT[item.href],
    ...(item.href === '/my-requests' ? { badge: requestBadge, badgeTone: 'blue' as const } : {}),
    ...(item.href === '/my-shipments' ? { badge: shipmentBadge, badgeTone: 'amber' as const } : {}),
  }))

  return (
    <AppShell
      navItems={items}
      tabHrefs={items.slice(0, 4).map(i => i.href)}
      userName={displayName}
      roleLabel={isAdminImpersonating ? 'Админ, гледа като продавач' : 'Продавач'}
      switchRole={isAdminImpersonating ? 'admin' : undefined}
    >
      {children}
    </AppShell>
  )
}
