import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function getProducts(filters?: {
  search?: string
  categoryId?: string
  storeId?: string
  status?: string
  sort?: string
  hasImages?: string
  limit?: number
  offset?: number
}) {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from('products')
    .select('*, category:categories(name), images:product_images(url, is_primary, sort_order)')

  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }
  // '__none__' asks for the products that have no category at all. A plain
  // falsy check cannot express that, since an empty value already means
  // 'do not filter'.
  if (filters?.categoryId === '__none__') {
    query = query.is('category_id', null)
  } else if (filters?.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (filters?.storeId) {
    // Filter products that have stock in the selected store
    const { data: storeProductIds } = await supabase
      .from('stock_batches')
      .select('product_id')
      .eq('store_id', filters.storeId)
      .gt('quantity_remaining', 0)
    const ids = [...new Set((storeProductIds || []).map((b: any) => b.product_id))]
    if (ids.length > 0) {
      query = query.in('id', ids)
    } else {
      return []
    }
  }
  if (filters?.status) {
    query = query.eq('status', filters.status)
  } else {
    query = query.eq('status', 'active')
  }
  if (filters?.sort === 'name') query = query.order('name')
  else if (filters?.sort === 'price_asc') query = query.order('price', { ascending: true })
  else if (filters?.sort === 'price_desc') query = query.order('price', { ascending: false })
  else query = query.order('created_at', { ascending: false })

  if (filters?.limit) query = query.limit(filters.limit)
  if (filters?.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1)

  const { data } = await query
  let result = data || []
  if (filters?.hasImages === 'yes') {
    result = result.filter((p: any) => p.images && p.images.length > 0)
  } else if (filters?.hasImages === 'no') {
    result = result.filter((p: any) => !p.images || p.images.length === 0)
  }
  return result
}

export { getCategories } from './categories'

export async function getProduct(id: string) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('products')
    .select('*, category:categories(*), images:product_images(*), labels:labels(*)')
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
    status: 'ordered' | 'received' | 'damaged' | 'returned' | 'active'
    quantity_on_hand: number
    created_at: string
    updated_at: string
    category: { id: string; name: string; description: string | null; parent_id: string | null; sort_order: number; created_at: string } | null
    images: { id: string; product_id: string; url: string; is_primary: boolean; sort_order: number; created_at: string }[]
    labels: { id: string; product_id: string; title: string; content: string; created_at: string }[]
  } | null
}
