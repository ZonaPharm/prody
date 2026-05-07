import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SettingsClient } from './settings-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, min_quantity')
    .eq('status', 'active')
    .order('name')

  return <SettingsClient products={products || []} />
}
