import { requireAdmin } from '@/lib/auth'
import { getProduct } from '@/lib/db/products'
import { getCategories } from '@/lib/db/categories'
import { notFound } from 'next/navigation'
import ProductForm from '@/components/products/product-form'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditProductPage({ params }: PageProps) {
  await requireAdmin()

  const { id } = await params
  const [product, categories] = await Promise.all([
    getProduct(id),
    getCategories(),
  ])

  if (!product) notFound()

  const label = product.labels?.[0] || null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Редактирай: {product.name}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Редактирай информацията за продукта
        </p>
      </div>

      <ProductForm
        initialData={{ ...product, label }}
        categories={categories as { id: string; name: string }[]}
      />
    </div>
  )
}
