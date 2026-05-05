import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function getStores() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('stores').select('*').order('name')
  return data || []
}

export async function createStore(values: { name: string; address?: string }) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('stores')
    .insert(values as any)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateStore(
  id: string,
  values: { name?: string; address?: string; is_active?: boolean }
) {
  const supabase = await createServerSupabaseClient()
  // @ts-expect-error — supabase-js type inference limitation with @supabase/ssr
  const { error } = await supabase.from('stores').update(values).eq('id', id)
  if (error) throw error
}
