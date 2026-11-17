'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Package } from 'lucide-react'
import { STATUS_LABELS, STATUS_VARIANTS, INACTIVE_REASON_LABELS } from '@/lib/constants'
import { ToggleStatusButton } from './toggle-status-button'
import { getImageSrc } from '@/lib/images'
import { STORE_STOCK_TONE, storeStockTone } from '@/lib/products/store-stock'

interface ProductCardProps {
  product: {
    id: string
    name: string
    description?: string | null
    price?: number | null
    status: string
    quantity_on_hand: number
    category?: { name: string } | null
    source_url?: string | null
    min_quantity?: number
    store_stock?: { store_name: string; qty: number }[]
    images?: { url: string; is_primary?: boolean; sort_order?: number }[] | { url: string } | null
  }
  href?: string
}

export default function ProductCard({ product, href }: ProductCardProps) {
  const images = Array.isArray(product.images) ? product.images : []
  const primaryImage = images.find(img => img.is_primary) || images[0]
  // A picture that does not load (missing in Storage, moved, offline) shows the
  // "no picture" box, not the browser's broken image with the name in big letters.
  const [imageFailed, setImageFailed] = useState(false)
  const stores = product.store_stock ?? []
  const stockTotal = stores.reduce((sum, s) => sum + s.qty, 0)

  const categoryName = product.category?.name
  const statusColors = STATUS_VARIANTS[product.status] || STATUS_VARIANTS.inactive
  const statusLabel = STATUS_LABELS[product.status] || product.status
  const inactiveReason = (product as any).inactive_reason
  const hasLowStock = product.store_stock?.some(s =>
    product.min_quantity && s.qty > 0 && s.qty <= product.min_quantity
  )

  return (
    <Link href={href ?? `/catalog/${product.id}`}>
      {/* Phone: a row with a small picture on the left, so a screen shows several products; wider: a card. */}
      <Card className={`flex h-full hover:shadow-md transition-shadow cursor-pointer group relative sm:block ${hasLowStock ? 'border-amber-300' : ''}`}>
        <div className="aspect-square w-28 shrink-0 self-start bg-slate-100 rounded-l-xl sm:w-auto sm:rounded-l-none sm:rounded-t-xl flex items-center justify-center overflow-hidden relative">
          <ToggleStatusButton productId={product.id} currentStatus={product.status} />
          {primaryImage && !imageFailed ? (
            <img
              src={getImageSrc(primaryImage.url)}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="flex flex-col items-center text-slate-400">
              <Package className="h-8 w-8 sm:h-12 sm:w-12 sm:mb-2" />
              <span className="hidden text-xs sm:inline">Няма снимка</span>
            </div>
          )}
        </div>

        <CardContent className="min-w-0 flex-1 p-3 space-y-1.5 sm:p-3">
          {/* Title + Status */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</h3>
            {/* "Активен" is the normal case: on a phone only the other statuses take room from the name. */}
            <Badge variant="secondary" className={`shrink-0 text-[10px] ${product.status === 'active' ? 'hidden sm:inline-flex' : ''} ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}>
              {statusLabel}
            </Badge>
          </div>

          {/* Category */}
          {categoryName && (
            <p className="text-[11px] text-muted-foreground">{categoryName}</p>
          )}
          {product.status === 'inactive' && inactiveReason && (
            <p className="text-[10px] text-muted-foreground">{INACTIVE_REASON_LABELS[inactiveReason] || inactiveReason}</p>
          )}

          {/* Price */}
          <p className="text-base font-bold tabular-nums">
            {product.price != null ? `${Number(product.price).toFixed(2)} €` : '—'}
          </p>

          {/* Store stock: every store in its own box, name above its count, so a
              count is never read as the next store's (they used to blur together). */}
          {stores.length > 0 && (
            <div className="border-t pt-1.5 mt-1 space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                <span>По обекти</span>
                <span className="tabular-nums">Общо {stockTotal} бр.</span>
              </div>
              {/* 3 boxes a row; on the narrowest phones 2, so the store names fit. */}
              <div className="grid grid-cols-2 gap-1 min-[360px]:grid-cols-3">
                {stores.map((s, i) => {
                  const tone = STORE_STOCK_TONE[storeStockTone(s.qty, product.min_quantity)]
                  return (
                    <div
                      key={i}
                      title={`${s.store_name}: ${s.qty} бр.`}
                      className={`min-w-0 rounded-md border px-1.5 py-1 ${tone.box}`}
                    >
                      <div className={`truncate text-[10px] font-medium leading-tight ${tone.name}`}>{s.store_name}</div>
                      <div className={`tabular-nums leading-tight ${tone.qty}`}>
                        <span className="text-sm font-bold">{s.qty}</span>
                        <span className="ml-0.5 text-[10px]">бр.</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Global stock fallback (no store_stock data) */}
          {(!product.store_stock || product.store_stock.length === 0) && (
            <p className={`text-[11px] tabular-nums ${
              product.quantity_on_hand === 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'
            }`}>
              {product.quantity_on_hand === 0 ? 'Изчерпан' : `Общо: ${product.quantity_on_hand} бр.`}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
