import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions } from '@/lib/deliveries/queries'
import { isUuid } from '@/lib/deliveries/api'
import { countOpenProblems, getLabelItems } from '@/lib/deliveries/work'
import { labelItems } from '@/lib/deliveries/queue'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { LabelChecklist } from '@/components/deliveries/label-checklist'
import { PageHeader } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

export default async function LabelsChecklistPage({ searchParams }: { searchParams: Promise<{ delivery?: string }> }) {
  const user = await requireDeliveriesAdmin()
  const { delivery } = await searchParams
  const supabase = await createServerSupabaseClient()
  const [items, stores, problems] = await Promise.all([getLabelItems(supabase), getStoreOptions(supabase), countOpenProblems(supabase)])
  const storeNames = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const rows = labelItems(items, id => storeNames[id] ?? '?')

  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="labels" problems={problems} office={user.role !== 'admin'} />
      <PageHeader title="Етикетиране" intro="Всичко получено, което е с етикет, минава оттук: и за магазините, и това, което остава в Офис." />
      <LabelChecklist rows={rows} storeNames={storeNames} userName={user.display_name} initialDelivery={delivery && isUuid(delivery) ? delivery : undefined} />
    </div>
  )
}
