import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { loadTasks } from '@/lib/deliveries/tasks-data'
import { TasksView } from '@/components/tasks/tasks-view'

export const dynamic = 'force-dynamic'

/**
 * "Задачи" for sellers: shipments to accept, what is coming to the store, the
 * trips they drive, and their notifications.
 */
export default async function MyTasksPage() {
  if (!deliveriesActive()) notFound()
  const user = await requireAuth()
  const { tasks, notifications } = await loadTasks(await createServerSupabaseClient(), createAdminClient(), {
    role: 'seller',
    userId: user.id,
    storeId: user.store_id ?? null,
  })
  return <TasksView tasks={tasks} notifications={notifications} />
}
