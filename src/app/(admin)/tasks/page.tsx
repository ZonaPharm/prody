import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { loadTasks } from '@/lib/deliveries/tasks-data'
import { TasksView } from '@/components/tasks/tasks-view'

export const dynamic = 'force-dynamic'

/** "Задачи" for Офис / admins: each step that waits, their own trips as driver, notifications. */
export default async function AdminTasksPage() {
  const user = await requireDeliveriesAdmin()
  const { tasks, notifications } = await loadTasks(await createServerSupabaseClient(), createAdminClient(), {
    role: 'admin',
    userId: user.id,
    storeId: null,
    officeOnly: user.role !== 'admin',
  })
  return <TasksView tasks={tasks} notifications={notifications} intro="Какво чака по доставките сега, по ред на стъпките, и известията за теб." />
}
