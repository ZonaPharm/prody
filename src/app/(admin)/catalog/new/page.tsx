import { requireAdmin } from '@/lib/auth'
import { getCategories } from '@/lib/db/categories'
import ProductForm from '@/components/products/product-form'

export default async function NewProductPage() {
  await requireAdmin()
  const categories = (await getCategories()) as { id: string; name: string }[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Добави продукт</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Добави нов продукт в каталога
        </p>
      </div>

      <ProductForm categories={categories} />
    </div>
  )
}
