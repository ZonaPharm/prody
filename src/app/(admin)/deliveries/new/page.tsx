import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getStoreOptions, getSupplierOptions } from '@/lib/deliveries/queries'
import { getCategories } from '@/lib/db/categories'
import { DeliveryEditor } from '@/components/deliveries/delivery-editor'

export const dynamic = 'force-dynamic'

/** A new delivery has no row until its first autosave. */
export default async function NewDeliveryPage() {
  await requireDeliveriesAdmin()
  const supabase = await createServerSupabaseClient()
  const [stores, suppliers, categories] = await Promise.all([
    getStoreOptions(supabase),
    getSupplierOptions(supabase),
    getCategories(),
  ])
  return (
    <DeliveryEditor
      initial={null}
      stores={stores}
      suppliers={suppliers}
      categories={(categories as any[]).map(c => ({ id: c.id, name: c.name }))}
    />
  )
}
