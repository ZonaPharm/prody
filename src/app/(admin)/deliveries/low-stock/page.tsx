import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { countOpenProblems, getTrips } from '@/lib/deliveries/work'
import { getLowStockInput } from '@/lib/deliveries/low-stock-data'
import { lowStock, withoutSales } from '@/lib/deliveries/low-stock'
import { hasRole } from '@/lib/roles'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { LowStockBoard, type OpenTrip } from '@/components/deliveries/low-stock-board'

export const dynamic = 'force-dynamic'

/**
 * Ниски наличности: what runs low in each store, with what Офис can send now
 * (Владимир, 2026-11-12). Администратор and Офис; Офис sees no sales numbers.
 */
export default async function LowStockPage() {
  const user = await requireDeliveriesAdmin()
  const isAdmin = hasRole(user as any, 'admin')
  const supabase = await createServerSupabaseClient()
  const [input, trips, problems] = await Promise.all([
    getLowStockInput(createAdminClient()),
    getTrips(supabase, 'active'),
    isAdmin ? countOpenProblems(supabase) : Promise.resolve(0),
  ])
  const result = lowStock(input)
  const rows = isAdmin ? result.rows.map(r => ({ ...r, fast: false })) : result.rows.map(withoutSales)

  const storeName = Object.fromEntries(input.stores.map(s => [s.id, s.name]))
  const office: Record<string, number> = {}
  for (const g of result.byProduct) office[g.product_id] = g.office
  const openTrips: OpenTrip[] = trips
    .filter(t => t.status === 'open')
    .map(t => ({
      id: t.id,
      number: t.number,
      planned_date: t.planned_date,
      stores: t.shipments.filter(s => s.status !== 'cancelled').map(s => storeName[s.store_id] ?? '—'),
    }))

  return (
    <div className="space-y-4 max-w-7xl pb-28">
      <DeliveriesTabs active="low" problems={problems} office={!isAdmin} />
      <LowStockBoard
        rows={rows}
        officeFree={result.officeFree}
        office={office}
        trips={openTrips}
        sales={isAdmin}
      />
    </div>
  )
}
