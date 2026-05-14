'use client'

import { Badge } from '@/components/ui/badge'
import { sofiaDate } from '@/lib/date-utils'

interface Movement {
  id: string
  type: string
  quantity: number
  unit_cost: number | null
  unit_price: number | null
  store_name: string
  notes: string | null
  created_at: string
}

const TYPE_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  restock: { label: 'Зареждане', variant: 'default', className: 'bg-green-100 text-green-800 border-green-200' },
  sell: { label: 'Продажба', variant: 'destructive', className: 'bg-red-100 text-red-800 border-red-200' },
  transfer_in: { label: 'Трансфер +', variant: 'outline', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  transfer_out: { label: 'Трансфер -', variant: 'outline', className: 'bg-orange-100 text-orange-800 border-orange-200' },
}

export function MovementHistory({ data }: { data: Movement[] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Няма движения</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-xs">Дата</th>
            <th className="text-left px-3 py-2 font-medium text-xs">Тип</th>
            <th className="text-left px-3 py-2 font-medium text-xs">Магазин</th>
            <th className="text-right px-3 py-2 font-medium text-xs">Кол.</th>
            <th className="text-right px-3 py-2 font-medium text-xs">Цена</th>
          </tr>
        </thead>
        <tbody>
          {data.map(m => {
            const badge = TYPE_BADGES[m.type] || { label: m.type, variant: 'secondary' as const, className: '' }
            return (
              <tr key={m.id} className="border-b last:border-0 hover:bg-slate-50/50">
                <td className="px-3 py-2 text-muted-foreground">
                  {sofiaDate(m.created_at)}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className={`text-[10px] ${badge.className} border`}>{badge.label}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{m.store_name}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${m.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {m.quantity >= 0 ? '+' : ''}{m.quantity}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {m.unit_cost != null ? `${m.unit_cost.toFixed(2)} €` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
