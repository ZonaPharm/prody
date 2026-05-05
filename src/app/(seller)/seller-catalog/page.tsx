import { requireAuth } from '@/lib/auth'
import { getProducts } from '@/lib/db/products'
import ProductCard from '@/components/products/product-card'

export default async function SellerCatalogPage() {
  await requireAuth()

  const products = await getProducts({ status: 'listed' })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Каталог</h1>

      {products.length === 0 ? (
        <p className="text-muted-foreground">Няма налични продукти в каталога.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product: any) => (
            <ProductCard
              key={product.id}
              product={product}
              href={`/seller-catalog/${product.id}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
