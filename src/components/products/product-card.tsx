import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Package } from 'lucide-react'
import { STATUS_LABELS, STATUS_VARIANTS, INACTIVE_REASON_LABELS } from '@/lib/constants'

interface ProductCardProps {
  product: {
    id: string
    name: string
    description?: string | null
    price?: number | null
    status: string
    quantity_on_hand: number
    category?: { name: string } | null
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
      <Card className="h-full hover:shadow-md transition-shadow cursor-pointer group">
        <div className="aspect-square bg-slate-100 rounded-t-lg flex items-center justify-center overflow-hidden">
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
            <span className="text-xs text-muted-foreground">
              {product.quantity_on_hand} бр.
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
