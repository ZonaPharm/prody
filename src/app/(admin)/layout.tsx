import { requireAdmin } from '@/lib/auth'
import { Package2, BarChart3, ShoppingBag, Settings, LayoutDashboard } from 'lucide-react'
import { AdminLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/catalog', label: 'Каталог', icon: Package2 },
  { href: '/sales', label: 'Продажби', icon: ShoppingBag },
  { href: '/reports', label: 'Отчети', icon: BarChart3 },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <AdminLayoutClient navItems={navItems}>
      {children}
    </AdminLayoutClient>
  )
}
