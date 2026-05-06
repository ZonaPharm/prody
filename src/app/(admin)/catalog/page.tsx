import { requireAdmin } from '@/lib/auth'
import { getProducts } from '@/lib/db/products'
import { getCategories } from '@/lib/db/categories'
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
  const products = await getProducts({
    search: params.search,
    status: params.status,
    sort: params.sort,
  })

  const categories = await getCategories()

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

      {products.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">Няма намерени продукти</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((product: any) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}
