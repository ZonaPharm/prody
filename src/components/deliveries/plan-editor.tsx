'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { equalSplit, overPlanned, unallocated } from '@/lib/deliveries/plan'
import type { CurrentStock } from '@/lib/deliveries/store-stock'
import { STORE_STOCK_TONE, storeStockTone } from '@/lib/products/store-stock'
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
 * already ready for it (after the delivery is saved). current shows under
 * each field what the store holds now (red none, amber at or below the
 * minimum); left out, nothing is shown.
 */
export function PlanEditor({
  quantity,
  stores,
  warehouseName,
  plan,
  onChange,
  minByStore,
  current,
  disabled,
}: {
  quantity: number
  stores: { id: string; name: string }[]
  warehouseName: string
  plan: PlanText
  onChange: (plan: PlanText) => void
  minByStore?: Record<string, number>
  /** What each store and Офис hold now; null = still loading; undefined = not shown. */
  current?: CurrentStock | null
  disabled?: boolean
}) {
  const nums = planNumbers(plan)
  const rest = unallocated(quantity, nums)
  const over = overPlanned(quantity, nums)
  // Rows for stores not shown here (e.g. a store switched off since) stay as
  // they are when the buttons below rewrite the plan.
  const shown = new Set(stores.map(s => s.id))
  const hidden: PlanText = Object.fromEntries(Object.entries(plan).filter(([k]) => !shown.has(k)))
  const hiddenQty = Object.entries(nums).reduce((s, [k, v]) => (shown.has(k) ? s : s + v), 0)

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
              {current !== undefined && (
                <NowBox qty={current?.byStore[s.id] ?? 0} min={current?.min ?? null} loading={current === null} where={s.name} />
              )}
            </label>
          )
        })}
        <div className="flex flex-col text-xs text-slate-600">
          <span>{warehouseName}</span>
          <span className={cn('h-8 flex items-center px-2 rounded bg-slate-100 text-sm font-medium tabular-nums', over > 0 && 'bg-red-50 text-red-700')}>
            {over > 0 ? `−${over}` : rest}
          </span>
          {current !== undefined && (
            <NowBox qty={current?.office ?? 0} min={null} loading={current === null} where={warehouseName} />
          )}
        </div>
        <div className="flex gap-1 pb-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || !(quantity - hiddenQty > 0)}
            onClick={() => {
              const split = equalSplit(quantity - hiddenQty, stores.map(s => s.id))
              onChange({ ...hidden, ...Object.fromEntries(Object.entries(split).map(([k, v]) => [k, v ? String(v) : ''])) })
            }}
          >
            Равно по всички
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(hidden)}>
            Изчисти
          </Button>
        </div>
      </div>
      {current !== undefined && (
        <p className="text-[11px] text-slate-500">
          „Сега“ е колко има в обекта в момента{current?.min ? `; жълто: ${current.min} бр. или по-малко (минимумът), червено: няма` : '; червено: няма'}.
        </p>
      )}
      {over > 0 && (
        <p className="text-xs text-red-600">Разпределени са {over} бр. повече от количеството на реда.</p>
      )}
    </div>
  )
}

/** What a store holds now, in the catalogue's colours. */
function NowBox({ qty, min, loading, where }: { qty: number; min: number | null; loading: boolean; where: string }) {
  const tone = STORE_STOCK_TONE[loading ? 'ok' : storeStockTone(qty, min)]
  return (
    <span
      data-testid="plan-now"
      title={loading ? undefined : `Сега в ${where}: ${qty} бр.`}
      className={cn('mt-1 flex w-20 items-baseline justify-between rounded border px-1.5 py-0.5 text-[11px] leading-tight', tone.box)}
    >
      <span className={tone.name}>сега</span>
      <span className={cn('font-semibold tabular-nums', tone.qty)}>{loading ? '…' : qty}</span>
    </span>
  )
}
