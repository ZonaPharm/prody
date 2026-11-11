import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { countOpenProblems, getDriverOptions, getTripDetail } from '@/lib/deliveries/work'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { TripView } from '@/components/deliveries/trip-view'

export const dynamic = 'force-dynamic'

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDeliveriesAdmin()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const [trip, drivers, problems] = await Promise.all([getTripDetail(supabase, id), getDriverOptions(supabase), countOpenProblems(supabase)])
  if (!trip) notFound()
  return (
    <div className="space-y-4 max-w-5xl">
      <DeliveriesTabs active="trips" problems={problems} />
      <TripView trip={trip} drivers={drivers} />
    </div>
  )
}
