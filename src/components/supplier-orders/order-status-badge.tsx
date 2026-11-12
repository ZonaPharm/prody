import { ORDER_STATUS_TONE, orderStatusLabel, type OrderStatus } from '@/lib/supplier-orders/format'
import { cn } from '@/lib/utils'

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        ORDER_STATUS_TONE[status as OrderStatus] ?? 'bg-slate-100 text-slate-700 border-slate-200',
        className,
      )}
    >
      {orderStatusLabel(status)}
    </span>
  )
}
