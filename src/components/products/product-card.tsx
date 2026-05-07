'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Package, ExternalLink } from 'lucide-react'
import { STATUS_LABELS, STATUS_VARIANTS, INACTIVE_REASON_LABELS } from '@/lib/constants'
import { ToggleStatusButton } from './toggle-status-button'

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

  const categoryName = product.category?.name

  const statusColors = STATUS_VARIANTS[product.status] || STATUS_VARIANTS.inactive
  const statusLabel = STATUS_LABELS[product.status] || product.status
  const inactiveReason = (product as any).inactive_reason

  return (
    <Link href={href ?? `/catalog/${product.id}`}>
      <Card className={`h-full hover:shadow-md transition-shadow cursor-pointer group ${product.quantity_on_hand === 0 ? 'border-red-300 bg-red-50/30' : ''}`}>
        <div className="aspect-square bg-slate-100 rounded-t-lg flex items-center justify-center overflow-hidden relative">
            <ToggleStatusButton productId={product.id} currentStatus={product.status} />
          {primaryImage ? (
            <img
              src={primaryImage.url}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="flex flex-col items-center text-slate-400">
              <Package className="h-12 w-12 mb-2" />
              <span className="text-xs">Няма снимка</span>
            </div>
          )}
        </div>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-sm leading-tight line-clamp-2">{product.name}</h3>
            <Badge variant="secondary" className={`shrink-0 text-[10px] ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}>
              {statusLabel}
            </Badge>
          </div>
          {categoryName && (
            <p className="text-xs text-muted-foreground">{categoryName}</p>
          )}
          {product.status === 'inactive' && inactiveReason && (
            <p className="text-[10px] text-muted-foreground">
              {INACTIVE_REASON_LABELS[inactiveReason] || inactiveReason}
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="font-semibold text-sm">
              {product.price != null ? `${Number(product.price).toFixed(2)} €` : '—'}
            </span>
            <span className={`text-xs ${
              product.quantity_on_hand === 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'
            }`}>
              {product.quantity_on_hand === 0 ? 'Изчерпан' : `${product.quantity_on_hand} бр.`}
            </span>
          </div>
          {product.source_url && (
            <a
              href={product.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 pt-1"
            >
              <ExternalLink className="h-3 w-3" />
              Отвори в Temu
            </a>
          )}
          {product.store_stock && product.store_stock.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {product.store_stock.map((s, i) => (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  s.qty === 0 ? 'bg-red-100 text-red-700' :
                  product.min_quantity && s.qty <= product.min_quantity ? 'bg-amber-100 text-amber-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {s.store_name}: {s.qty}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
