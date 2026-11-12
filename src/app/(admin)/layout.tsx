import { redirect } from 'next/navigation'
import { getEffectiveRole, requireAuth } from '@/lib/auth'
import { canSell, canWorkDeliveries, homePath, rolesOf, rolesText } from '@/lib/roles'
import { deliveriesEnabledFor } from '@/lib/deliveries/feature'
import { AdminLayoutClient } from './layout-client'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { countOpenProblems } from '@/lib/deliveries/work'
import { createAdminClient } from '@/lib/supabase/admin'
import { taskBadge } from '@/lib/deliveries/tasks-data'

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
// "Задачи" right after "Табло", with the same switch.
const TASKS_ITEM = { href: '/tasks', label: 'Задачи' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  const isAdmin = user.role === 'admin'
  if (isAdmin && (await getEffectiveRole(user)) !== 'admin') redirect('/record-sale')
  // Офис (not an admin) gets only Задачи and Доставки here; every other admin page
  // checks requireAdmin itself. Anyone else goes to their own start page.
  if (!isAdmin && !(canWorkDeliveries(user) && deliveriesEnabledFor(user.email))) redirect(homePath(user))

  const deliveries = deliveriesEnabledFor(user.email)
  // Open "Не е наред" signals: a red count beside "Доставки".
  let problems = 0
  let tasks = 0
  if (deliveries) {
    const supabase = await createServerSupabaseClient()
    ;[problems, tasks] = await Promise.all([
      countOpenProblems(supabase).catch(() => 0),
      taskBadge(supabase, createAdminClient(), { role: 'admin', userId: user.id, storeId: null }).catch(() => 0),
    ])
  }
  if (!isAdmin) {
    const officeItems = [
      { ...TASKS_ITEM, badge: tasks },
      { href: '/deliveries/labels', label: 'Етикетиране' },
      { href: '/deliveries/trips', label: 'Курсове' },
      ...(canSell(user) ? [{ href: '/record-sale', label: 'Каса' }] : []),
    ]
    return (
      <AdminLayoutClient navItems={officeItems} userName={user.display_name || user.email} tasks={tasks}
        roleLabel={rolesText(rolesOf(user))} switchRole={null}>
        {children}
      </AdminLayoutClient>
    )
  }

  const items = deliveries
    ? navItems.flatMap(item =>
        item.href === '/requests' ? [{ ...DELIVERIES_ITEM, badge: problems }, item]
        : item.href === '/dashboard' ? [item, { ...TASKS_ITEM, badge: tasks }]
        : [item])
    : navItems

  return (
    <AdminLayoutClient navItems={items} userName={user.display_name || user.email} tasks={deliveries ? tasks : undefined}>
      {children}
    </AdminLayoutClient>
  )
}
