export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { getProduct } from '@/lib/db/products'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { Printer, Pencil, Trash2, Package, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getImageSrc } from '@/lib/images'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants'
import { logAction } from '@/lib/audit'
import { ProductInventoryTab } from '@/components/inventory/product-inventory-tab'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ restock?: string; qty?: string; cost?: string }>
}

export default async function ProductDetailPage({ params, searchParams }: PageProps) {
  await requireAdmin()

  const { id } = await params
  const sp = await searchParams
  const product = await getProduct(id)

  if (!product) notFound()

  const supabase = await createServerSupabaseClient()

  // Fetch stock per store for this product
  const { data: productBatches } = await (supabase.from('stock_batches') as any)
    .select('quantity_remaining, store:stores(name)')
    .eq('product_id', id)

  const storeStockMap: Record<string, number> = {}
  ;(productBatches || []).forEach((b: any) => {
    const name = b.store?.name || (Array.isArray(b.store) ? b.store[0]?.name : '—')
    storeStockMap[name] = (storeStockMap[name] || 0) + b.quantity_remaining
  })

  const { data: stores } = await (supabase.from('stores') as any)
    .select('id, name, is_warehouse')
    .eq('is_active', true)
    .order('name')

  const statusColors = STATUS_VARIANTS[product.status] || STATUS_VARIANTS.inactive
  const statusLabel = STATUS_LABELS[product.status] || product.status

  const images = Array.isArray(product.images) ? product.images : []
  const primaryImage = images.find((img: any) => img.is_primary) || images[0]
  const extraImages = images.filter((img: any) => img !== primaryImage)

  async function deleteProduct(formData: FormData) {
    'use server'
    await requireAdmin()
    const productId = formData.get('id') as string
    const supabase = await createServerSupabaseClient()

    // Clean up inventory records first (FK constraints)
    await (supabase.from('stock_movements') as any).delete().eq('product_id', productId)
    await (supabase.from('stock_batches') as any).delete().eq('product_id', productId)
    await (supabase.from('product_images') as any).delete().eq('product_id', productId)
    await (supabase.from('labels') as any).delete().eq('product_id', productId)

    const { error: deleteError } = await supabase.from('products').delete().eq('id', productId)
    if (deleteError) {
      // If still failing (e.g. sales records exist), show a clear message
      redirect(`/catalog/${productId}?error=${encodeURIComponent(deleteError.message || 'delete_failed')}`)
    }
    await logAction({ action: 'delete_product', entityType: 'product', entityId: productId, details: product?.name || productId }, supabase)
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
            {primaryImage ? (
              <img
                src={getImageSrc(primaryImage.url)}
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

        {/* Details + Description merged */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Детайли</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Цена</p>
                  <p className="font-medium">
                    {product.price != null ? `${Number(product.price).toFixed(2)} €` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Доставна цена</p>
                  <p className="font-medium">
                    {product.cost_price != null ? `${Number(product.cost_price).toFixed(2)} €` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Категория</p>
                  <p className="font-medium">{product.category?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Статус</p>
                  <Badge variant="secondary" className={`mt-0.5 ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}>{statusLabel}</Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Наличност</p>
                  <p className="font-medium">{product.quantity_on_hand}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Мин. к-во</p>
                  <p className="font-medium">{(product as any).min_quantity ?? 5}</p>
                </div>
                {Object.keys(storeStockMap).length > 0 && (
                  <div className="col-span-full">
                    <p className="text-sm text-muted-foreground mb-2">Наличности по обекти</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(storeStockMap)
                        .sort(([, a], [, b]) => b - a)
                        .map(([name, qty]) => (
                          <span key={name} className={`text-xs px-2 py-1 rounded-full ${
                            qty === 0 ? 'bg-red-100 text-red-700' :
                            qty <= ((product as any).min_quantity ?? 5) ? 'bg-amber-100 text-amber-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {name}: <strong>{qty}</strong>
                          </span>
                        ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Източник</p>
                  <p className="font-medium">{product.source || '—'}</p>
                </div>
              </div>
              {product.description && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-1">Описание</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {product.description}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {(() => {
            const label = Array.isArray(product.labels) ? product.labels[0] : null
            if (!label) return null
            return (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">{label.title || 'Етикет'}</CardTitle>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/labels?title=${encodeURIComponent(label.title)}&text=${encodeURIComponent(label.content)}`}>
                      <Printer className="mr-1 h-4 w-4" />
                      Принтирай
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {label.content}
                  </p>
                </CardContent>
              </Card>
            )
          })()}
        </div>
      </div>

      {/* Inventory section */}
      <div className="mt-6">
        <ProductInventoryTab
          productId={product.id}
          productName={product.name}
          stores={(stores || []) as any}
          autoRestock={sp.restock === '1'}
          initialQty={sp.qty ? parseInt(sp.qty) : undefined}
          initialCost={sp.cost ? parseFloat(sp.cost) : undefined}
        />
      </div>
    </div>
  )
}
