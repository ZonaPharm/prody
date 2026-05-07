import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { LowStockClient } from './low-stock-client'

export const dynamic = 'force-dynamic'

export default async function LowStockPage() {
  const user = await requireAuth()
  const supabase = await createServerSupabaseClient()
  const storeId = user.store_id

  if (!storeId) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Нямате зададен магазин
      </div>
    )
  }

  // Get products with batches in this store (including zero)
  const { data: batches } = await (supabase.from('stock_batches') as any)
    .select('product_id, quantity_remaining')
    .eq('store_id', storeId)

  const productQtys: Record<string, number> = {}
  ;(batches || []).forEach((b: any) => {
    productQtys[b.product_id] = (productQtys[b.product_id] || 0) + b.quantity_remaining
  })

  // Get product details
  const productIds = Object.keys(productQtys)
  const { data: products } = productIds.length > 0
    ? await (supabase.from('products') as any)
        .select('id, name, price, min_quantity, category:categories(name)')
        .in('id', productIds)
        .order('name')
    : { data: [] }

  const items = (products || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    category: p.category?.name || (Array.isArray(p.category) ? p.category[0]?.name : null),
    min_quantity: p.min_quantity || 5,
    current_qty: productQtys[p.id] || 0,
  })).filter((p: any) => p.current_qty <= p.min_quantity)
    .sort((a: any, b: any) => a.current_qty - b.current_qty)

  return <LowStockClient items={items} storeId={storeId} />
}
