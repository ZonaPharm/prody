import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function getCategories() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('categories').select('*').order('sort_order')
  return data || []
}

export async function createCategory(values: {
  name: string
  description?: string
  parent_id?: string | null
  sort_order?: number
}) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('categories')
    .insert(values as any)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCategory(
  id: string,
  values: {
    name?: string
    description?: string
    parent_id?: string | null
    sort_order?: number
  }
) {
  const supabase = await createServerSupabaseClient()
  // @ts-expect-error — supabase-js type inference limitation with @supabase/ssr
  const { error } = await supabase.from('categories').update(values).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(id: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}
