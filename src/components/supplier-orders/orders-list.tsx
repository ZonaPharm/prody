'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { OrderStatusBadge } from './order-status-badge'
import { formatOrderNumber } from '@/lib/supplier-orders/format'
import { formatDeliveryNumber } from '@/lib/deliveries/format'
import { sofiaDate } from '@/lib/date-utils'
import type { OrderFilter, OrderListRow } from '@/lib/supplier-orders/queries'
import { cn } from '@/lib/utils'
import { Empty, Meta } from '@/components/ui/text'

const TABS: { value: OrderFilter; label: string }[] = [
  { value: 'open', label: 'Чакат' },
  { value: 'received', label: 'Пристигнали' },
  { value: 'cancelled', label: 'Отказани' },
  { value: 'all', label: 'Всички' },
]

/** What the row says about where the order is now. */
function whereText(r: OrderListRow): string {
  if (r.status === 'draft') return 'Чернова: не е изпратена'
  if (r.status === 'sent') return `${r.sent_via === 'manual' ? 'Поръчана сами' : 'Изпратена по имейл'} на ${sofiaDate(r.sent_at!)} · чака стоката`
  if (r.status === 'received') return r.delivery_number != null ? `Пристигна: доставка ${formatDeliveryNumber(r.delivery_number)}` : 'Пристигна: доставката е чернова'
  return 'Отказана'
}

export function OrdersList({ rows, filter }: { rows: OrderListRow[]; filter: OrderFilter }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r => [formatOrderNumber(r.number), r.supplier_name, r.creator ?? ''].some(t => t.toLowerCase().includes(needle)))
  }, [rows, q])

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <div className="flex sm:inline-flex rounded-lg border bg-white p-0.5 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => router.push(t.value === 'open' ? '/deliveries/orders' : `/deliveries/orders?filter=${t.value}`)}
              className={cn(
                'flex-1 sm:flex-none whitespace-nowrap px-3 py-2 sm:py-1.5 text-sm rounded-md',
                filter === t.value ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:min-w-[200px] sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Номер, доставчик…" className="pl-8 bg-white" />
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty className="rounded-lg border bg-white">
          {rows.length === 0
            ? filter === 'open'
              ? 'Няма поръчки, които чакат. Натиснете „Нова поръчка“, за да поръчате от доставчик.'
              : 'Няма поръчки тук.'
            : 'Нищо не отговаря на търсенето.'}
        </Empty>
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {shown.map(r => (
            <li key={r.id}>
              <Link href={`/deliveries/orders/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 hover:bg-slate-50 active:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{formatOrderNumber(r.number)}</span>
                    <span className="font-medium">{r.supplier_name}</span>
                    <OrderStatusBadge status={r.status} />
                  </div>
                  <Meta as="div">{whereText(r)}</Meta>
                </div>
                <div className="text-right text-sm tabular-nums">
                  <div>{r.lines} {r.lines === 1 ? 'продукт' : 'продукта'}, {r.units} бр.</div>
                  <Meta as="div">{sofiaDate(r.created_at)}{r.creator ? ` · ${r.creator}` : ''}</Meta>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
