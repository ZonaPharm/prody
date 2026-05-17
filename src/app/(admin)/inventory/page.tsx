import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { InventoryClient } from './inventory-client'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  await requireAdmin()

  const supabase = await createServerSupabaseClient()
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return <InventoryClient stores={(stores || []) as { id: string; name: string }[]} />
}
