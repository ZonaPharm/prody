import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { countOpenProblems } from '@/lib/deliveries/work'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { OrdersList } from '@/components/supplier-orders/orders-list'
import { getOrdersList, type OrderFilter } from '@/lib/supplier-orders/queries'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

const FILTERS: OrderFilter[] = ['open', 'received', 'cancelled', 'all']

/** Orders to suppliers: what we asked for and still wait for, and what came. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  await requireDeliveriesAdmin({ adminOnly: true })
  const sp = await searchParams
  const filter: OrderFilter = FILTERS.includes(sp.filter as OrderFilter) ? (sp.filter as OrderFilter) : 'open'
  const supabase = await createServerSupabaseClient()
  const [rows, problems] = await Promise.all([getOrdersList(supabase, filter), countOpenProblems(supabase)])

  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="orders" problems={problems} />
      <PageHeader
        title="Поръчки към доставчици"
        intro="Изберете доставчик и продукти, изпратете му поръчката. Когато стоката дойде, тя става доставка."
        actions={<Button asChild><Link href="/deliveries/orders/new"><Plus className="mr-2 h-4 w-4" />Нова поръчка</Link></Button>}
      />
      <OrdersList rows={rows} filter={filter} />
    </div>
  )
}
