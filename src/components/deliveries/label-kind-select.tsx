'use client'

import { LABEL_KINDS, LABEL_KIND_HINT, LABEL_KIND_LABEL, type LabelKind } from '@/lib/label-kind'
import { cn } from '@/lib/utils'

/**
 * "Етикет": Пълен етикет / Само цена / Готов. compact = one small select for a delivery
 * line; otherwise three choices with what each means (new product, product card).
 */
export function LabelKindSelect({ value, onChange, disabled, compact, id }: {
  value: LabelKind
  onChange: (v: LabelKind) => void
  disabled?: boolean
  compact?: boolean
  id?: string
}) {
  if (compact) {
    return (
      <select
        id={id}
        className="h-7 rounded-md border border-input bg-white px-1.5 text-xs"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value as LabelKind)}
        aria-label="Етикет"
        title={LABEL_KIND_HINT[value]}
      >
        {LABEL_KINDS.map(k => <option key={k} value={k}>{LABEL_KIND_LABEL[k]}</option>)}
      </select>
    )
  }
  return (
    <div role="radiogroup" aria-label="Етикет" className="grid gap-2 sm:grid-cols-3">
      {LABEL_KINDS.map(k => (
        <label
          key={k}
          className={cn(
            'flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-sm',
            value === k ? 'border-primary bg-primary/5' : 'hover:bg-slate-50',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <input type="radio" name={id ?? 'label-kind'} className="h-4 w-4" checked={value === k} disabled={disabled} onChange={() => onChange(k)} />
            {LABEL_KIND_LABEL[k]}
          </span>
          <span className="text-xs text-muted-foreground">{LABEL_KIND_HINT[k]}</span>
        </label>
      ))}
    </div>
  )
}
