import { requireAdmin } from '@/lib/auth'
import { getProducts } from '@/lib/db/products'
import { getCategories } from '@/lib/db/categories'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Suspense } from 'react'
import ProductSearch from '@/components/products/product-search'
import ProductCard from '@/components/products/product-card'

interface PageProps {
  searchParams: Promise<{ search?: string; status?: string; sort?: string }>
}

export default async function CatalogPage({ searchParams }: PageProps) {
  await requireAdmin()

  const params = await searchParams
  const [products, categories] = await Promise.all([
    getProducts({ search: params.search, status: params.status, sort: params.sort }),
    getCategories(),
  ])

  // Fetch per-store stock for all products
  const supabase = await createServerSupabaseClient()
  const productIds = (products || []).map((p: any) => p.id)
  const { data: storeBatches } = productIds.length > 0 ? await (supabase.from('stock_batches') as any)
    .select('product_id, quantity_remaining, store:stores(name)')
    .in('product_id', productIds)
    .order('store(name)')
    : { data: [] }

  // Aggregate stock per product per store (merge duplicates by store name)
  const stockMap: Record<string, { store_name: string; qty: number }[]> = {}
  ;(storeBatches || []).forEach((b: any) => {
    const storeName = b.store?.name || (Array.isArray(b.store) ? b.store[0]?.name : '—')
    if (!stockMap[b.product_id]) stockMap[b.product_id] = []
    // Merge with existing entry for same store
    const existing = stockMap[b.product_id].find(s => s.store_name === storeName)
    if (existing) {
      existing.qty += b.quantity_remaining
    } else {
      stockMap[b.product_id].push({ store_name: storeName, qty: b.quantity_remaining })
    }
  })

  // Attach stock data to products
  const productsWithStock = (products || []).map((p: any) => ({
    ...p,
    store_stock: stockMap[p.id] || [],
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Каталог</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {products.length} продукт{products.length === 1 ? '' : 'а'}
          </p>
        </div>
        <Button asChild>
          <Link href="/catalog/new">
            <Plus className="mr-2 h-4 w-4" />
            Добави продукт
          </Link>
        </Button>
      </div>

      <Suspense fallback={<div className="h-10 bg-muted animate-pulse rounded-md" />}>
        <ProductSearch />
      </Suspense>

      {productsWithStock.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">Няма намерени продукти</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {productsWithStock.map((product: any) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
