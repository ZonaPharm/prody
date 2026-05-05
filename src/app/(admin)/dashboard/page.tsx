import { requireAdmin } from '@/lib/auth'

export default async function DashboardPage() {
  await requireAdmin()
  return <div><h1 className="text-2xl font-bold">Дашборд</h1></div>
}
