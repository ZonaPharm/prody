import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { getProducts } from '@/lib/db/products'

export async function GET(req: NextRequest) {
  await requireAdmin()

  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const search = searchParams.get('search') || undefined
  const status = searchParams.get('status') || undefined
  const sort = searchParams.get('sort') || undefined
  const category = searchParams.get('category') || undefined
  const store = searchParams.get('store') || undefined

  const products = await getProducts({
    search, status, sort,
    categoryId: category,
    storeId: store,
    limit, offset,
  })

  // Load stock for this batch of products only (50 at a time, not 488!)
  const supabase = await createServerSupabaseClient()
  const productIds = (products || []).map((p: any) => p.id)
  const { data: storeBatches } = productIds.length > 0
    ? await (supabase.from('stock_batches') as any)
        .select('product_id, quantity_remaining, store:stores(name)')
        .in('product_id', productIds)
        .order('store(name)')
    : { data: [] }

  const stockMap: Record<string, { store_name: string; qty: number }[]> = {}
  ;(storeBatches || []).forEach((b: any) => {
    const storeName = b.store?.name || (Array.isArray(b.store) ? b.store[0]?.name : '—')
    if (!stockMap[b.product_id]) stockMap[b.product_id] = []
    const existing = stockMap[b.product_id].find(s => s.store_name === storeName)
    if (existing) existing.qty += b.quantity_remaining
    else stockMap[b.product_id].push({ store_name: storeName, qty: b.quantity_remaining })
  })

  const productsWithStock = products.map((p: any) => ({
    ...p,
    store_stock: stockMap[p.id] || [],
  }))

  return NextResponse.json({ products: productsWithStock, hasMore: products.length >= limit })
}
