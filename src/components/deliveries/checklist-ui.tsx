'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, Check, Loader2, PenLine } from 'lucide-react'
import {
  KIND_LABEL,
  STEP_KINDS,
  kindNeedsQty,
  problemError,
  qtyQuestion,
  signalReason,
  type Problem,
  type ProblemKind,
  type RowState,
  type Step,
} from '@/lib/deliveries/checklist'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

/**
 * Shared pieces of the phase 3 checklists: the row's tick and "Не е наред"
 * buttons, the dialog that asks what is wrong, and the signature bar.
 */

export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function rowTone(state: RowState | undefined): string {
  if (state?.problem) return 'bg-red-50/60'
  if (state?.checked) return 'bg-emerald-50/60'
  return ''
}

/** The tick (a big checkbox) of one row; disabled while the row has a problem. */
export function RowTick({ state, label, onChange }: { state: RowState | undefined; label: string; onChange: (on: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="h-6 w-6 shrink-0"
      aria-label={label}
      checked={!!state?.checked && !state?.problem}
      disabled={!!state?.problem}
      onChange={e => onChange(e.target.checked)}
    />
  )
}

export function ProblemButton({ state, onOpen, onClear }: { state: RowState | undefined; onOpen: () => void; onClear: () => void }) {
  return state?.problem ? (
    <Button variant="ghost" size="sm" onClick={onClear}>Отмени</Button>
  ) : (
    <Button variant="outline" size="sm" className="text-red-700 border-red-200" onClick={onOpen}>
      <AlertTriangle className="mr-1 h-4 w-4" />Не е наред
    </Button>
  )
}

export function ProblemText({ step, problem }: { step: Step; problem: Problem }) {
  return (
    <div className="mt-1 text-sm text-red-800">
      {KIND_LABEL[step][problem.kind]}
      {kindNeedsQty(problem.kind) && `: ${problem.qty} бр.`}
      {problem.note ? ` · „${problem.note}“` : ''}
      {!signalReason(problem.kind) && <span className="text-xs text-slate-600"> (без сигнал)</span>}
    </div>
  )
}

export function ProblemDialog({ step, title, expected, hint, onClose, onSave }: {
  step: Step
  title: string
  expected: number
  hint?: string
  onClose: () => void
  onSave: (p: Problem) => void
}) {
  const [kind, setKind] = useState<ProblemKind | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  function save() {
    if (!kind) return setError('Изберете какво не е наред')
    const p: Problem = { kind, qty: kindNeedsQty(kind) ? (qty.trim() === '' ? NaN : Number(qty)) : 0, note: note.trim() || undefined }
    const err = problemError(step, p, expected)
    if (err) return setError(err)
    onSave(p)
  }

  const question = kind ? qtyQuestion(step, kind) : ''

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Не е наред: {title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{hint ?? `Очакват се ${expected} бр.`}</p>
        <div className="grid grid-cols-2 gap-2">
          {STEP_KINDS[step].map(k => (
            <button key={k} type="button" onClick={() => { setKind(k); setError('') }}
              className={cn('rounded-md border px-3 py-2 text-sm text-left', kind === k ? 'border-slate-900 bg-slate-900 text-white' : 'hover:bg-slate-50')}>
              {KIND_LABEL[step][k]}
            </button>
          ))}
        </div>
        {kind && kindNeedsQty(kind) && (
          <label className="block text-sm space-y-1">
            <span>{question}</span>
            <Input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ''))} autoFocus aria-label={question} />
          </label>
        )}
        {kind && (
          <label className="block text-sm space-y-1">
            <span>Бележка{kind === 'other' ? '' : ' (по избор)'}</span>
            <Input value={note} onChange={e => setNote(e.target.value)} aria-label="Бележка" />
          </label>
        )}
        {kind && !signalReason(kind) && (
          <p className="text-xs text-muted-foreground">
            {step === 'label' ? 'Останалото остава в „Етикетиране“ за по-късно.' : 'Останалото остава готово в Офис за следващ курс.'} Не се праща сигнал.
          </p>
        )}
        {kind && signalReason(kind) && (
          <p className="text-xs text-muted-foreground">
            Админите получават сигнал с Вашето име.
            {step === 'store' && ' Липсващите бройки излизат от наличността на обекта, докато админ не реши.'}
            {step === 'pack' && ' Липсващите бройки вече не се броят за готови и се връщат в „Етикетиране“.'}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Отказ</Button>
          <Button onClick={save}>Готово</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The bar at the bottom: who signs (the account), when, and what. "Подписвам"
 * opens a confirmation with the sentence the signature stands for.
 */
export function SignBar({ userName, summary, statement, disabled, disabledReason, error, signing, onSign, children }: {
  userName: string
  summary: string
  statement: string
  disabled: boolean
  disabledReason?: string
  error?: string
  signing: boolean
  /** Resolves when the request is over (the screen shows its own error); the dialog then closes. */
  onSign: () => Promise<void>
  children?: React.ReactNode
}) {
  const now = useNow()
  const [open, setOpen] = useState(false)

  async function confirm() {
    await onSign()
    setOpen(false)
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 lg:left-56 border-t bg-white/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-5xl flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <div className="font-medium" suppressHydrationWarning>{userName} · {sofiaDateTime(now)}</div>
            <div className="text-muted-foreground">{summary}</div>
          </div>
          {children}
          {(error || (disabled && disabledReason)) && (
            <span className={cn('text-sm', error ? 'text-red-600' : 'text-amber-700')}>{error || disabledReason}</span>
          )}
          <Button className="ml-auto" disabled={disabled || signing} onClick={() => setOpen(true)}>
            <PenLine className="mr-2 h-4 w-4" />Подписвам
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Подпис</DialogTitle></DialogHeader>
          <p className="text-sm">С подписа си казвате: „{statement}“</p>
          <p className="text-sm text-muted-foreground">{userName} · {sofiaDateTime(now)} · {summary}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Назад</Button>
            <Button onClick={confirm} disabled={signing}>
              {signing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Подписвам
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** POST JSON and return the answer, or throw with the server's Bulgarian message. */
export async function postJson<T = any>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let data: any = {}
  try {
    data = await res.json()
  } catch {
    // An empty or non-JSON answer: use the fallback below.
  }
  if (!res.ok) throw new Error(data?.error || fallback)
  return data as T
}
