import { requireAdmin } from '@/lib/auth'
import { deliveriesEnabledFor } from '@/lib/deliveries/feature'
import { AdminLayoutClient } from './layout-client'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { countOpenProblems } from '@/lib/deliveries/work'

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

// "Доставки" sits between Инвентаризация and Заявки, only where the feature
// switch is on for this admin (see src/lib/deliveries/feature.ts).
const DELIVERIES_ITEM = { href: '/deliveries', label: 'Доставки' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin()

  const deliveries = deliveriesEnabledFor(user.email)
  // Open "Не е наред" signals: a red count beside "Доставки".
  let problems = 0
  if (deliveries) {
    try {
      problems = await countOpenProblems(await createServerSupabaseClient())
    } catch {}
  }
  const items = deliveries
    ? navItems.flatMap(item => (item.href === '/requests' ? [{ ...DELIVERIES_ITEM, badge: problems }, item] : [item]))
    : navItems

  return (
    <AdminLayoutClient navItems={items} userName={user.display_name || user.email}>
      {children}
    </AdminLayoutClient>
  )
}
