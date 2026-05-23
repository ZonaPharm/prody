export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { getProducts } from '@/lib/db/products'
import { getCategories } from '@/lib/db/categories'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Suspense } from 'react'
import ProductSearch from '@/components/products/product-search'
import ProductCard from '@/components/products/product-card'
import { ExportButton } from '@/components/products/export-button'

interface PageProps {
  searchParams: Promise<{ search?: string; status?: string; sort?: string; hasImages?: string; category?: string; store?: string }>
}

export default async function CatalogPage({ searchParams }: PageProps) {
  await requireAdmin()

  const params = await searchParams
  const admin = createAdminClient()

  const [products, categories, stores] = await Promise.all([
    getProducts({ search: params.search, status: params.status, sort: params.sort, hasImages: params.hasImages, categoryId: params.category, storeId: params.store }),
    getCategories(),
    admin.from('stores').select('id, name').eq('is_active', true).order('name').then(r => r.data || []),
  ])

  // Load ALL stock_batches (avoid IN filter URI limit)
  const { data: storeBatches } = await (admin.from('stock_batches') as any)
    .select('product_id, quantity_remaining, store:stores(name)')
    .order('store(name)')

  const stockMap: Record<string, { store_name: string; qty: number }[]> = {}
  ;(storeBatches || []).forEach((b: any) => {
    const storeName = b.store?.name || (Array.isArray(b.store) ? b.store[0]?.name : '—')
    if (!stockMap[b.product_id]) stockMap[b.product_id] = []
    const existing = stockMap[b.product_id].find(s => s.store_name === storeName)
    if (existing) existing.qty += b.quantity_remaining
    else stockMap[b.product_id].push({ store_name: storeName, qty: b.quantity_remaining })
  })

  const productsWithStock = (products || []).map((p: any) => ({
    ...p,
    store_stock: stockMap[p.id] || [],
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Каталог</h1>
        </div>
        <div className="flex items-center gap-2">
          <Suspense>
            <ExportButton />
          </Suspense>
          <Button asChild>
            <Link href="/catalog/new">
              <Plus className="mr-2 h-4 w-4" />
              Добави продукт
            </Link>
          </Button>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-4 lg:-mx-8 px-4 lg:px-8 py-3 bg-slate-50/95 backdrop-blur-sm">
        <Suspense fallback={<div className="h-10 bg-muted animate-pulse rounded-md" />}>
          <ProductSearch categories={categories as { id: string; name: string }[]} stores={stores as { id: string; name: string }[]} />
        </Suspense>
      </div>

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
