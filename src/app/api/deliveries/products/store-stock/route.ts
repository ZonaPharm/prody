import { NextResponse } from 'next/server'
import { deliveriesGate } from '@/lib/deliveries/api'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { parseProductIds, sumStockByStore } from '@/lib/deliveries/store-stock'

/**
 * What each store and Офис hold now of the given products (?ids=a,b,c), for
 * the distribution under a delivery line: { stock: product → store → units,
 * min: product → products.min_quantity }.
 */
export async function GET(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response
  const supabase = gate.supabase as any

  const ids = parseProductIds(new URL(request.url).searchParams.get('ids'))
  if (ids.length === 0) return NextResponse.json({ stock: {}, min: {} })

  type Batch = { product_id: string; store_id: string; quantity_remaining: number }
  type Product = { id: string; min_quantity: number | null }
  try {
    // 50 products per request, and every page of their batches (1000-row cap).
    const [batches, products] = await Promise.all([
      fetchByIds<Batch>(async chunk => ({
        data: await fetchAll<Batch>(() => supabase
          .from('stock_batches')
          .select('id, product_id, store_id, quantity_remaining')
          .in('product_id', chunk)
          .gt('quantity_remaining', 0)
          .order('id')),
        error: null,
      }), ids, 50),
      fetchByIds<Product>(chunk => supabase.from('products').select('id, min_quantity').in('id', chunk), ids, 50),
    ])
    const min: Record<string, number | null> = Object.fromEntries(
      products.map(p => [p.id, p.min_quantity ?? null]),
    )
    return NextResponse.json({ stock: sumStockByStore(ids, batches), min })
  } catch (e) {
    console.error('store-stock failed:', JSON.stringify(e))
    return NextResponse.json({ error: 'Наличностите по обекти не можаха да се заредят' }, { status: 500 })
  }
}
