import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions } from '@/lib/deliveries/queries'
import { countOpenProblems, getOpenPlanRows, getTrips, getUnsentLines } from '@/lib/deliveries/work'
import { readyByStore, readyLinesByStore } from '@/lib/deliveries/queue'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { TripsBoard } from '@/components/deliveries/trips-board'
import { ChecklistSteps } from '@/components/deliveries/checklist-ui'

export const dynamic = 'force-dynamic'

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireDeliveriesAdmin()
  const sp = await searchParams
  const filter = sp.filter === 'all' ? 'all' : 'active'
  const supabase = await createServerSupabaseClient()
  const [trips, plan, unsent, stores, problems] = await Promise.all([
    getTrips(supabase, filter),
    getOpenPlanRows(supabase),
    getUnsentLines(supabase),
    getStoreOptions(supabase),
    countOpenProblems(supabase),
  ])
  const storeName = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const readyLines = readyLinesByStore(plan, unsent)
  const ready = readyByStore(plan, unsent)
    .filter(s => storeName[s.store_id] && !stores.find(x => x.id === s.store_id)?.is_warehouse)
    .map(s => ({ ...s, name: storeName[s.store_id], lines: readyLines[s.store_id] ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  // Units planned for the stores that still wait for their label (not ready yet).
  const waitingLabel = plan
    .filter(r => !stores.find(x => x.id === r.store_id)?.is_warehouse)
    .reduce((n, r) => n + Math.max(0, Math.min(r.planned_qty, r.received_qty) - r.ready_qty), 0)

  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="trips" problems={problems} />
      <div>
        <h1 className="text-2xl font-bold">Курсове</h1>
        <p className="text-sm text-muted-foreground">
          Курсът (К-…) е едно тръгване на машината с по една пратка (П-…) за всеки магазин.
        </p>
      </div>
      <ChecklistSteps steps={[
        <>Отметнете магазините и натиснете <b>„Направи курс“</b>. Влиза всичко, което е готово за тях.</>,
        <>В курса натиснете <b>„Опаковай“</b> за всяка пратка: отметнете какво е в кашона и подпишете.</>,
        <><b>Шофьорът подписва</b> с паролата си и курсът тръгва. Магазинът приема пратката от „Пратки“.</>,
      ]} />
      <TripsBoard trips={trips} ready={ready} storeName={storeName} filter={filter} waitingLabel={waitingLabel} />
    </div>
  )
}
