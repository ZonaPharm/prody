import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import SaleEntry from '@/components/sales/sale-entry'
import { AlertTriangle } from 'lucide-react'

type Store = { id: string; name: string }

export default async function RecordSalePage() {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)

  const supabase = await createServerSupabaseClient()

  const { data: stores } = await (supabase
    .from('stores') as any)
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (!stores || stores.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>Няма налични обекти. Свържете се с администратор.</p>
      </div>
    )
  }

  let defaultStoreId = user.store_id

  // Admin impersonating seller: use first available store
  if (!defaultStoreId && user.role === 'admin' && effectiveRole === 'seller') {
    defaultStoreId = stores[0].id
  }

  // Seller without a store_id but stores exist: use first store
  if (!defaultStoreId) {
    defaultStoreId = stores[0].id
  }

  return <SaleEntry stores={stores as Store[]} defaultStoreId={defaultStoreId!} userId={user.id} />
}
