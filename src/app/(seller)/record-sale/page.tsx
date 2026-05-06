import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import SaleEntry from '@/components/sales/sale-entry'
import { AlertTriangle } from 'lucide-react'

export default async function RecordSalePage() {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)

  let storeId = user.store_id

  // Admin impersonating seller: use first available store
  if (!storeId && user.role === 'admin' && effectiveRole === 'seller') {
    const supabase = await createServerSupabaseClient()
    const { data: store } = await (supabase
      .from('stores') as any)
      .select('id')
      .limit(1)
      .single()
    if (store) storeId = store.id
  }

  if (!storeId) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>Нямате зададен магазин. Свържете се с администратор.</p>
      </div>
    )
  }

  return <SaleEntry storeId={storeId} userId={user.id} />
}
