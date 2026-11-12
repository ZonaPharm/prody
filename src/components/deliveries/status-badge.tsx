import { DELIVERY_STATUS_TONE, deliveryStatusLabel, type DeliveryStatus } from '@/lib/deliveries/format'
import { cn } from '@/lib/utils'

export function DeliveryStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        DELIVERY_STATUS_TONE[status as DeliveryStatus] ?? 'bg-slate-100 text-slate-700 border-slate-200',
        className,
      )}
    >
      {deliveryStatusLabel(status)}
    </span>
  )
}
