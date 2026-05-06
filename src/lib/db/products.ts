import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function getProducts(filters?: {
  search?: string
  categoryId?: string
  status?: string
  sort?: string
}) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from('products')
    .select('*, category:categories(name), images:product_images(url, is_primary, sort_order)')

  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }
  if (filters?.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (filters?.status) {
    query = query.eq('status', filters.status)
  }
  if (filters?.sort === 'name') query = query.order('name')
  else if (filters?.sort === 'price_asc') query = query.order('price', { ascending: true })
  else if (filters?.sort === 'price_desc') query = query.order('price', { ascending: false })
  else query = query.order('created_at', { ascending: false })

  const { data } = await query
  return data || []
}

export { getCategories } from './categories'

export async function getProduct(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('products')
    .select('*, category:categories(*), images:product_images(*)')
    .eq('id', id)
    .single()
  return data as any as {
    id: string
    name: string
    description: string | null
    price: number | null
    cost_price: number | null
    sku: string | null
    barcode: string | null
    category_id: string | null
    source: string | null
    source_url: string | null
    source_order_date: string | null
    status: 'ordered' | 'received' | 'damaged' | 'returned' | 'listed'
    quantity_on_hand: number
    created_at: string
    updated_at: string
    category: { id: string; name: string; description: string | null; parent_id: string | null; sort_order: number; created_at: string } | null
    images: { id: string; product_id: string; url: string; is_primary: boolean; sort_order: number; created_at: string }[]
  } | null
}
