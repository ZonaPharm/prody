'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { sofiaToday } from '@/lib/date-utils'
import { activeQuickRange, quickRange, type QuickRange } from '@/lib/date-ranges'

interface MySalesFiltersProps {
  from: string
  to: string
}

const QUICK: { key: QuickRange; label: string }[] = [
  { key: 'today', label: 'Днес' },
  { key: 'week', label: 'Седмица' },
  { key: 'month', label: 'Месец' },
]

export function MySalesFilters({ from, to }: MySalesFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const today = sofiaToday()
  const active = activeQuickRange(from, to, today)

  const navigate = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.replace(`/my-sales?${params.toString()}`)
  }

  const pick = (kind: QuickRange) => {
    const r = quickRange(kind, today)
    router.replace(`/my-sales?from=${r.from}&to=${r.to}`)
  }

  return (
    <div className="space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-2">
      {/* Quick ranges first: one tap covers what a seller looks at most */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 sm:order-last">
        {QUICK.map(q => (
          <button key={q.key} type="button" onClick={() => pick(q.key)}
            className={cn(
              'flex-1 sm:flex-none rounded-md px-3 py-2 sm:py-1.5 text-sm font-medium transition-colors',
              active === q.key ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
        <div>
          <label className="text-xs text-muted-foreground">От</label>
          <Input type="date" key={`f${from}`} defaultValue={from} onChange={e => navigate('from', e.target.value)} className="w-full sm:w-[160px] h-10 sm:h-9 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">До</label>
          <Input type="date" key={`t${to}`} defaultValue={to} onChange={e => navigate('to', e.target.value)} className="w-full sm:w-[160px] h-10 sm:h-9 text-sm" />
        </div>
      </div>
    </div>
  )
}
