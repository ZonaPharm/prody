import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions } from '@/lib/deliveries/queries'
import { isUuid } from '@/lib/deliveries/api'
import { countOpenProblems, getLabelItems } from '@/lib/deliveries/work'
import { labelItems } from '@/lib/deliveries/queue'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { LabelChecklist } from '@/components/deliveries/label-checklist'

export const dynamic = 'force-dynamic'

export default async function LabelsChecklistPage({ searchParams }: { searchParams: Promise<{ delivery?: string }> }) {
  const user = await requireDeliveriesAdmin()
  const { delivery } = await searchParams
  const supabase = await createServerSupabaseClient()
  const [items, stores, problems] = await Promise.all([getLabelItems(supabase), getStoreOptions(supabase), countOpenProblems(supabase)])
  const storeNames = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const rows = labelItems(items, id => storeNames[id] ?? '?')

  return (
    <div className="space-y-4 max-w-5xl">
      <DeliveriesTabs active="labels" problems={problems} />
      <div>
        <h1 className="text-2xl font-bold">Етикетиране</h1>
        <p className="text-sm text-muted-foreground">
          Всичко получено чака етикет, и това, което остава в Офис. Отпечатването не отбелязва нищо: отметнете реда, когато бройките са преопаковани (ако трябва) и с налепен етикет. Готовите за магазините отиват в следващия курс, останалите стоят в Офис. Ако са готови само част, натиснете „Само част“, напишете колко и къде отиват, в рамките на плана. Неотметнатото остава за по-късно.
        </p>
      </div>
      <LabelChecklist rows={rows} storeNames={storeNames} userName={user.display_name} initialDelivery={delivery && isUuid(delivery) ? delivery : undefined} />
    </div>
  )
}
