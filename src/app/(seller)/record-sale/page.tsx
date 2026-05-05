import { requireAuth } from '@/lib/auth'
import SaleEntry from '@/components/sales/sale-entry'
import { AlertTriangle } from 'lucide-react'

export default async function RecordSalePage() {
  const user = await requireAuth()

  if (!user.store_id) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>Нямате зададен магазин. Свържете се с администратор.</p>
      </div>
    )
  }

  return <SaleEntry storeId={user.store_id} userId={user.id} />
}
