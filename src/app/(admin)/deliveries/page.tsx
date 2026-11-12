import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getDeliveriesList, type ListFilter } from '@/lib/deliveries/queries'
import { DeliveriesList } from '@/components/deliveries/deliveries-list'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { countOpenProblems } from '@/lib/deliveries/work'
import { Button } from '@/components/ui/button'
import { Plus, Send } from 'lucide-react'

export const dynamic = 'force-dynamic'

const FILTERS: ListFilter[] = ['open', 'completed', 'cancelled', 'all']

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireDeliveriesAdmin({ adminOnly: true })
  const sp = await searchParams
  const filter: ListFilter = FILTERS.includes(sp.filter as ListFilter) ? (sp.filter as ListFilter) : 'open'

  const supabase = await createServerSupabaseClient()
  const [rows, problems] = await Promise.all([getDeliveriesList(supabase, filter), countOpenProblems(supabase)])

  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="list" problems={problems} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Доставки</h1>
          <p className="text-sm text-muted-foreground">Стоката от доставчиците: въвеждане, получаване в Офис и дневник.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/deliveries/orders/new"><Send className="mr-2 h-4 w-4" />Поръчай от доставчик</Link>
          </Button>
          <Button asChild>
            <Link href="/deliveries/new"><Plus className="mr-2 h-4 w-4" />Нова доставка</Link>
          </Button>
        </div>
      </div>
      <DeliveriesList rows={rows} filter={filter} />
    </div>
  )
}
