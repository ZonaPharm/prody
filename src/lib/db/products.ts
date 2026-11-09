import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function getProducts(filters?: {
  search?: string
  categoryId?: string
  storeId?: string
  status?: string
  sort?: string
  hasImages?: string
  wp?: string
  limit?: number
  offset?: number
}) {
  const supabase = await createServerSupabaseClient()
  // The store filter joins the batches in the database (an inner embed: only
  // products with at least one matching batch come back, once each). It used
  // to fetch the store's product ids first and send them back in .in('id', …),
  // which put every id into the request URL; past roughly 398 products the URL
  // grew too long and the filtered catalogue came back empty.
  const columns = '*, category:categories(name), images:product_images(url, is_primary, sort_order)'
  let query = (supabase.from('products') as any)
    .select(filters?.storeId ? `${columns}, in_store:stock_batches!inner(id)` : columns)

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
  // 'not_synced' asks for the products that have never reached the shop. As
  // with the category filter, a plain falsy check cannot express it, since an
  // empty value already means 'do not filter'.
  if (filters?.wp === 'not_synced') {
    query = query.is('wp_product_id', null)
  }
  if (filters?.storeId) {
    // Products with stock in the selected store.
    query = query
      .eq('in_store.store_id', filters.storeId)
      .gt('in_store.quantity_remaining', 0)
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
  // The joined batches only served the filter; callers (the catalogue, its
  // export) never expected them on the product.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let result = (data || []).map(({ in_store, ...product }: any) => product)
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
