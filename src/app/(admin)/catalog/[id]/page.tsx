import { requireAdmin } from '@/lib/auth'
import { getProduct } from '@/lib/db/products'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { Printer, Pencil, Trash2, Package, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProductDetailPage({ params }: PageProps) {
  await requireAdmin()

  const { id } = await params
  const product = await getProduct(id)

  if (!product) notFound()

  const variant = STATUS_VARIANTS[product.status] || 'default'
  const statusLabel = STATUS_LABELS[product.status] || product.status

  const images = Array.isArray(product.images) ? product.images : []
  const firstImage = images[0]
  const extraImages = images.slice(1)

  async function deleteProduct(formData: FormData) {
    'use server'
    await requireAdmin()
    const productId = formData.get('id') as string
    const supabase = await createServerSupabaseClient()
    const { error } = await supabase.from('products').delete().eq('id', productId)
    if (error) {
      redirect(`/catalog/${productId}?error=delete_failed`)
    }
    revalidatePath('/catalog')
    redirect('/catalog')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/catalog">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Назад
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {product.category?.name || 'Без категория'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/labels?productId=${product.id}`}>
              <Printer className="mr-1 h-4 w-4" />
              Етикет
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/catalog/${product.id}/edit`}>
              <Pencil className="mr-1 h-4 w-4" />
              Редактирай
            </Link>
          </Button>
          <form action={deleteProduct}>
            <input type="hidden" name="id" value={product.id} />
            <Button variant="destructive" size="sm" type="submit">
              <Trash2 className="mr-1 h-4 w-4" />
              Изтрий
            </Button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Images */}
        <div className="lg:col-span-1 space-y-4">
          <div className="aspect-square bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden">
            {firstImage ? (
              <img
                src={firstImage.url}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center text-slate-400">
                <Package className="h-16 w-16 mb-2" />
                <span className="text-sm">Няма снимка</span>
              </div>
            )}
          </div>
          {extraImages.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {extraImages.map((img: any) => (
                <div
                  key={img.id}
                  className="aspect-square bg-slate-100 rounded-md overflow-hidden"
                >
                  <img
                    src={img.url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Детайли</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Цена</p>
                  <p className="font-medium">
                    {product.price != null ? `${Number(product.price).toFixed(2)} лв` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Доставна цена</p>
                  <p className="font-medium">
                    {product.cost_price != null ? `${Number(product.cost_price).toFixed(2)} лв` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Категория</p>
                  <p className="font-medium">{product.category?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Статус</p>
                  <Badge variant={variant} className="mt-0.5">{statusLabel}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Наличност</p>
                  <p className="font-medium">{product.quantity_on_hand}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">SKU</p>
                  <p className="font-medium">{product.sku || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Баркод</p>
                  <p className="font-medium">{product.barcode || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Източник</p>
                  <p className="font-medium">{product.source || '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {product.description && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-lg">Описание</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {product.description}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
