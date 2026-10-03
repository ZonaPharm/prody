import { requireAdmin } from '@/lib/auth'
import { getProduct } from '@/lib/db/products'
import { getCategories } from '@/lib/db/categories'
import { createServerSupabaseClient } from '@/lib/supabase/server'
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

  // The form shows stock read-only when editing (it never writes it back), so
  // give it what the batches hold rather than the drifting quantity_on_hand.
  const supabase = await createServerSupabaseClient()
  const { data: batches } = await (supabase.from('stock_batches') as any)
    .select('quantity_remaining')
    .eq('product_id', id)
  const totalStock = (batches || []).reduce((sum: number, b: any) => sum + b.quantity_remaining, 0)

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
        initialData={{ ...product, quantity_on_hand: totalStock, label }}
        categories={categories as { id: string; name: string }[]}
      />
    </div>
  )
}
