import { createServerSupabaseClient } from '@/lib/supabase/server'

/** Settings → Доставчици, for the product form: all of them, hidden ones too. */
export async function getSuppliers(): Promise<{ id: string; name: string; is_active: boolean }[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await (supabase.from('suppliers') as any)
    .select('id, name, is_active')
    .order('name')
    .limit(1000)
  return (data ?? []) as { id: string; name: string; is_active: boolean }[]
}
