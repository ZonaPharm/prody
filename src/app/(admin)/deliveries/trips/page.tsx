import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions } from '@/lib/deliveries/queries'
import { countOpenProblems, getOpenPlanRows, getTrips, getUnsentLines } from '@/lib/deliveries/work'
import { readyByStore } from '@/lib/deliveries/queue'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { TripsBoard } from '@/components/deliveries/trips-board'

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
  const ready = readyByStore(plan, unsent)
    .filter(s => storeName[s.store_id] && !stores.find(x => x.id === s.store_id)?.is_warehouse)
    .map(s => ({ ...s, name: storeName[s.store_id] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))

  return (
    <div className="space-y-4 max-w-5xl">
      <DeliveriesTabs active="trips" problems={problems} />
      <div>
        <h1 className="text-2xl font-bold">Курсове</h1>
        <p className="text-sm text-muted-foreground">
          Курсът (К-…) е едно тръгване на машината. В него има по една пратка (П-…) за всеки магазин, с готовото от всички доставки.
        </p>
      </div>
      <TripsBoard trips={trips} ready={ready} storeName={storeName} filter={filter} />
    </div>
  )
}
