'use client'

import { AppShell, type ShellNavItem } from '@/components/layout/app-shell'
import { RequestsBadge } from '@/components/admin/requests-badge'

interface NavItem {
  href: string
  label: string
  badge?: number
}

// Phone tab bar: the four screens an admin opens most; the rest go under "Още".
const TABS_WITH_DELIVERIES = ['/dashboard', '/sales', '/catalog', '/deliveries']
const TABS = ['/dashboard', '/sales', '/catalog', '/requests']

export function AdminLayoutClient({
  navItems,
  userName,
  tasks,
  children,
}: {
  navItems: NavItem[]
  userName: string
  /** The "Задачи" count, when deliveries are on for this admin. */
  tasks?: number
  children: React.ReactNode
}) {
  const items: ShellNavItem[] = navItems.map(item => ({
    ...item,
    badgeTone: item.href === '/tasks' ? 'blue' : 'red',
    badgeNode: item.href === '/requests' ? <RequestsBadge /> : undefined,
  }))
  const hasDeliveries = navItems.some(i => i.href === '/deliveries')

  return (
    <AppShell
      navItems={items}
      tabHrefs={hasDeliveries ? TABS_WITH_DELIVERIES : TABS}
      userName={userName}
      roleLabel="Администратор"
      switchRole="seller"
      bell={tasks === undefined ? undefined : { href: '/tasks', count: tasks }}
    >
      {children}
    </AppShell>
  )
}
