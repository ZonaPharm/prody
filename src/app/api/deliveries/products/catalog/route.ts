import { NextResponse } from 'next/server'
import { deliveriesGate } from '@/lib/deliveries/api'
import { getProducts } from '@/lib/db/products'
import { loadSuggestions, toDeliveryProducts } from '@/lib/deliveries/products'

const PAGE = 50

/**
 * The "Каталог" dialog of the delivery entry: the catalogue's own filters
 * (search, category, store, status), 50 at a time.
 */
export async function GET(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response

  const sp = new URL(request.url).searchParams
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const status = sp.get('status') === 'inactive' ? 'inactive' : 'active'

  const products = await getProducts({
    search: (sp.get('search') ?? '').replace(/[%,()\\]/g, ' ').trim() || undefined,
    categoryId: sp.get('category') || undefined,
    storeId: sp.get('store') || undefined,
    status,
    sort: 'name',
    limit: PAGE,
    offset,
  })

  const { lastLines, suppliers } = await loadSuggestions(gate.supabase, products.map((p: { id: string }) => p.id))
  return NextResponse.json({
    products: toDeliveryProducts(products, lastLines, suppliers),
    hasMore: products.length === PAGE,
  })
}
