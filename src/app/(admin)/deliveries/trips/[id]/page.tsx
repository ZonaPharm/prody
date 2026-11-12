import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { getStoreOptions } from '@/lib/deliveries/queries'
import { countOpenProblems, getDriverOptions, getOpenPlanRows, getTripDetail, getUnsentLines } from '@/lib/deliveries/work'
import { readyByStore } from '@/lib/deliveries/queue'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { TripView } from '@/components/deliveries/trip-view'
import { sofiaToday } from '@/lib/date-utils'

export const dynamic = 'force-dynamic'

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDeliveriesAdmin()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const [trip, drivers, problems, plan, unsent, stores] = await Promise.all([
    getTripDetail(supabase, id),
    getDriverOptions(supabase),
    countOpenProblems(supabase),
    getOpenPlanRows(supabase),
    getUnsentLines(supabase),
    getStoreOptions(supabase),
  ])
  if (!trip) notFound()
  // What became ready after the trip was made, and is on no trip yet ("Добави в курса").
  const storeName = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const ready = trip.status !== 'open' ? [] : readyByStore(plan, unsent)
    .filter(s => storeName[s.store_id] && !stores.find(x => x.id === s.store_id)?.is_warehouse)
    .map(s => ({ ...s, name: storeName[s.store_id] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'bg'))
  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="trips" problems={problems} />
      <TripView trip={trip} drivers={drivers} ready={ready} today={sofiaToday()}
        stores={stores.filter(s => !s.is_warehouse).map(s => ({ id: s.id, name: s.name }))} />
    </div>
  )
}
