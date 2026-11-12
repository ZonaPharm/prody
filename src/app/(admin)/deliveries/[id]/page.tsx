import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getDeliveryDetail, getStoreOptions, getSupplierOptions } from '@/lib/deliveries/queries'
import { isUuid } from '@/lib/deliveries/api'
import { getCategories } from '@/lib/db/categories'
import { DeliveryEditor, type DraftInitial } from '@/components/deliveries/delivery-editor'
import { DeliveryView } from '@/components/deliveries/delivery-view'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { countOpenProblems } from '@/lib/deliveries/work'
import type { DeliveryDetail } from '@/lib/deliveries/queries'

export const dynamic = 'force-dynamic'

function toDraft(d: DeliveryDetail): DraftInitial {
  return {
    id: d.id,
    updated_at: d.updated_at,
    header: { order_ref: d.order_ref ?? '', notes: d.notes ?? '' },
    lines: d.items.map(i => ({
      key: i.id,
      id: i.id,
      product: { id: i.product_id, name: i.product_name, sku: i.product_sku, image: i.image, status: i.product_status, price: i.product_price },
      supplier_id: i.supplier_id,
      doc_number: i.doc_number ?? '',
      quantity: String(i.quantity),
      pack_size: i.pack_size > 1 ? String(i.pack_size) : '',
      unit_cost: String(i.unit_cost).replace('.', ','),
      needs_label: i.needs_label,
      plan: Object.fromEntries(i.plan.map(p => [p.store_id, String(p.planned_qty)])),
    })),
  }
}

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDeliveriesAdmin()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const supabase = await createServerSupabaseClient()
  const [delivery, stores, suppliers] = await Promise.all([
    getDeliveryDetail(supabase, id),
    getStoreOptions(supabase),
    getSupplierOptions(supabase),
  ])
  if (!delivery) notFound()

  if (delivery.status === 'draft') {
    const categories = await getCategories()
    return (
      <DeliveryEditor
        initial={toDraft(delivery)}
        stores={stores}
        suppliers={suppliers}
        categories={(categories as any[]).map(c => ({ id: c.id, name: c.name }))}
      />
    )
  }

  const problems = await countOpenProblems(supabase)
  return (
    <div className="space-y-4">
      <DeliveriesTabs active="list" problems={problems} />
      <DeliveryView delivery={delivery} stores={stores} userName={user.display_name} />
    </div>
  )
}
