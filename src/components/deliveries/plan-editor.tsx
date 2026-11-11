'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { equalSplit, overPlanned, unallocated } from '@/lib/deliveries/plan'
import { cn } from '@/lib/utils'

export type PlanText = Record<string, string> // store_id → typed text

export function planNumbers(plan: PlanText): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(plan)) {
    const n = parseInt(v, 10)
    out[k] = Number.isFinite(n) && n > 0 ? n : 0
  }
  return out
}

/**
 * The per-store plan of one line, like the "Зареди" dialog: a field per store,
 * the rest goes to Офис. minByStore keeps a store from going below what is
 * already ready for it (after the delivery is saved).
 */
export function PlanEditor({
  quantity,
  stores,
  warehouseName,
  plan,
  onChange,
  minByStore,
  disabled,
}: {
  quantity: number
  stores: { id: string; name: string }[]
  warehouseName: string
  plan: PlanText
  onChange: (plan: PlanText) => void
  minByStore?: Record<string, number>
  disabled?: boolean
}) {
  const nums = planNumbers(plan)
  const rest = unallocated(quantity, nums)
  const over = overPlanned(quantity, nums)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {stores.map(s => {
          const min = minByStore?.[s.id] ?? 0
          const below = min > 0 && (nums[s.id] ?? 0) < min
          return (
            <label key={s.id} className="flex flex-col text-xs text-slate-600">
              <span className="truncate max-w-[88px]" title={s.name}>{s.name}</span>
              <Input
                inputMode="numeric"
                aria-label={`План за ${s.name}`}
                disabled={disabled}
                className={cn('h-8 w-20 text-sm bg-white', below && 'border-red-500')}
                value={plan[s.id] ?? ''}
                placeholder="0"
                onChange={e => onChange({ ...plan, [s.id]: e.target.value.replace(/[^0-9]/g, '') })}
              />
              {min > 0 && <span className={cn('mt-0.5', below ? 'text-red-600' : 'text-slate-400')}>готови {min}</span>}
            </label>
          )
        })}
        <div className="flex flex-col text-xs text-slate-600">
          <span>{warehouseName}</span>
          <span className={cn('h-8 flex items-center px-2 rounded bg-slate-100 text-sm font-medium tabular-nums', over > 0 && 'bg-red-50 text-red-700')}>
            {over > 0 ? `−${over}` : rest}
          </span>
        </div>
        <div className="flex gap-1 pb-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || !(quantity > 0)}
            onClick={() => {
              const split = equalSplit(quantity, stores.map(s => s.id))
              onChange(Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v ? String(v) : ''])))
            }}
          >
            Равно по всички
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({})}>
            Изчисти
          </Button>
        </div>
      </div>
      {over > 0 && (
        <p className="text-xs text-red-600">Разпределени са {over} бр. повече от количеството на реда.</p>
      )}
    </div>
  )
}
