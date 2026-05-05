import { requireAuth } from '@/lib/auth'

export default async function RecordSalePage() {
  await requireAuth()
  return <div><h1 className="text-2xl font-bold">Запиши продажба</h1></div>
}
