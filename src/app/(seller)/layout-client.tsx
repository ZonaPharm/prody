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
  '/my-tasks': 'Задачи',
}

export function SellerLayoutClient({
  navItems,
  displayName,
  isAdminImpersonating,
  children,
  requestBadge,
  shipmentBadge,
  taskBadge,
}: {
  navItems: NavItem[]
  displayName: string
  isAdminImpersonating: boolean
  children: React.ReactNode
  requestBadge?: number
  shipmentBadge?: number
  /** Set when deliveries are on: the bell in the phone's top bar and the menu count. */
  taskBadge?: number
}) {
  const items: ShellNavItem[] = navItems.map(item => ({
    ...item,
    short: SHORT[item.href],
    ...(item.href === '/my-requests' ? { badge: requestBadge, badgeTone: 'blue' as const } : {}),
    ...(item.href === '/my-shipments' ? { badge: shipmentBadge, badgeTone: 'amber' as const } : {}),
    ...(item.href === '/my-tasks' ? { badge: taskBadge, badgeTone: 'blue' as const } : {}),
  }))

  return (
    <AppShell
      navItems={items}
      tabHrefs={items.slice(0, 4).map(i => i.href)}
      userName={displayName}
      roleLabel={isAdminImpersonating ? 'Админ, гледа като продавач' : 'Продавач'}
      switchRole={isAdminImpersonating ? 'admin' : undefined}
      bell={taskBadge === undefined ? undefined : { href: '/my-tasks', count: taskBadge }}
    >
      {children}
    </AppShell>
  )
}
