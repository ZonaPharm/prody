import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions } from '@/lib/deliveries/queries'
import { countOpenProblems, getOpenPlanRows } from '@/lib/deliveries/work'
import { labelQueue } from '@/lib/deliveries/queue'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { LabelChecklist } from '@/components/deliveries/label-checklist'

export const dynamic = 'force-dynamic'

export default async function LabelsChecklistPage() {
  const user = await requireDeliveriesAdmin()
  const supabase = await createServerSupabaseClient()
  const [plan, stores, problems] = await Promise.all([getOpenPlanRows(supabase), getStoreOptions(supabase), countOpenProblems(supabase)])
  const storeName = new Map(stores.map(s => [s.id, s.name]))
  const name = (id: string) => storeName.get(id) ?? '?'
  const rows = labelQueue(plan, name).map(r => ({ ...r, store_name: name(r.store_id) }))

  return (
    <div className="space-y-4 max-w-5xl">
      <DeliveriesTabs active="labels" problems={problems} />
      <div>
        <h1 className="text-2xl font-bold">Етикетиране</h1>
        <p className="text-sm text-muted-foreground">
          Отметнете редовете, които са етикетирани и опаковани за магазина. Неотметнатото остава за по-късно. Число се пише само при „Не е наред“.
        </p>
      </div>
      <LabelChecklist rows={rows} userName={user.display_name} />
    </div>
  )
}
