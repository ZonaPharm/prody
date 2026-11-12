'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { AlertTriangle, Search } from 'lucide-react'
import { DeliveryStatusBadge } from './status-badge'
import { formatDeliveryNumber, formatMoney } from '@/lib/deliveries/format'
import { sofiaDate } from '@/lib/date-utils'
import type { DeliveryListRow, ListFilter } from '@/lib/deliveries/queries'
import { cn } from '@/lib/utils'

const TABS: { value: ListFilter; label: string }[] = [
  { value: 'open', label: 'Отворени' },
  { value: 'completed', label: 'Завършени' },
  { value: 'cancelled', label: 'Отказани' },
  { value: 'all', label: 'Всички' },
]

export function DeliveriesList({ rows, filter }: { rows: DeliveryListRow[]; filter: ListFilter }) {
  const router = useRouter()
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r =>
      [formatDeliveryNumber(r.number), r.order_ref ?? '', ...r.suppliers, ...r.docs, r.creator ?? '']
        .some(t => t.toLowerCase().includes(needle)),
    )
  }, [rows, q])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-white p-0.5">
          {TABS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => router.push(t.value === 'open' ? '/deliveries' : `/deliveries?filter=${t.value}`)}
              className={cn(
                'px-3 py-1.5 text-sm rounded',
                filter === t.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Номер, доставчик, фактура…"
            className="pl-8 bg-white"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? 'Няма доставки тук.' : 'Нищо не отговаря на търсенето.'}
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Номер</th>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Доставчик</th>
                <th className="px-3 py-2 text-right">Редове</th>
                <th className="px-3 py-2 text-right">Бройки</th>
                <th className="px-3 py-2 w-40">Получени</th>
                <th className="px-3 py-2 text-right">Стойност</th>
                <th className="px-3 py-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const pct = r.units > 0 ? Math.round((r.received / r.units) * 100) : 0
                return (
                  <tr key={r.id} className="border-t hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      <Link href={`/deliveries/${r.id}`} className="text-blue-700 hover:underline">
                        {formatDeliveryNumber(r.number)}
                      </Link>
                      {r.open_signals > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 text-xs text-red-700" title="Отворени проблеми">
                          <AlertTriangle className="h-3 w-3" />{r.open_signals}
                        </span>
                      )}
                      {r.order_ref && <div className="text-xs text-muted-foreground">Поръчка {r.order_ref}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{sofiaDate(r.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="truncate max-w-[220px]" title={r.suppliers.join(', ')}>{r.suppliers.join(', ') || '—'}</div>
                      {r.docs.length > 0 && (
                        <div className="text-xs text-muted-foreground truncate max-w-[220px]" title={r.docs.join(', ')}>
                          Ф-ра {r.docs.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.lines}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.units}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded bg-slate-100">
                          <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-slate-600 w-16 text-right">{r.received}/{r.units}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatMoney(r.value)}</td>
                    <td className="px-3 py-2"><DeliveryStatusBadge status={r.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
