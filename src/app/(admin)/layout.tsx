import { requireAdmin } from '@/lib/auth'
import { AdminLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/dashboard', label: 'Табло' },
  { href: '/catalog', label: 'Каталог' },
  { href: '/sales', label: 'Продажби' },
  { href: '/reports', label: 'Отчети' },
  { href: '/inventory', label: 'Инвентаризация' },
  { href: '/requests', label: 'Заявки' },
  { href: '/settings', label: 'Настройки' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <AdminLayoutClient navItems={navItems}>
      {children}
    </AdminLayoutClient>
  )
}
