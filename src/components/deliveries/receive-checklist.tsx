'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, ArrowLeft, Loader2, PenLine, Search } from 'lucide-react'
import { formatDeliveryNumber, formatQtyWithPacks } from '@/lib/deliveries/format'
import {
  PROBLEM_LABEL,
  buildReceiveBody,
  problemError,
  problemNeedsQty,
  receiveSummary,
  type ReceiveProblem,
  type ReceiveRowState,
} from '@/lib/deliveries/receive'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { ProductThumb } from './product-picker'
import { RowTick } from './checklist-ui'

export type ReceiveRowView = {
  item_id: string
  product_name: string
  product_sku: string | null
  image: string | null
  supplier_name: string | null
  doc_number: string | null
  pack_size: number
  quantity: number
  received_qty: number
  remaining: number
  needs_label: boolean
}

const KINDS: ReceiveProblem['kind'][] = ['partial', 'short', 'damaged', 'wrong_product', 'missing', 'other']

/**
 * "Получаване": the parcel against the invoice lines. Tick a row when all that
 * is still expected arrived; "Не е наред" when not, and only there type how
 * many. Unticked rows stay open for the next parcel. "Подписвам" sends it all
 * in one go, signed by the account.
 */
export function ReceiveChecklist({ deliveryId, number, rows, userName }: {
  deliveryId: string
  number: number | null
  rows: ReceiveRowView[]
  userName: string
}) {
  const router = useRouter()
  const [state, setState] = useState<Record<string, ReceiveRowState>>({})
  const [filter, setFilter] = useState('')
  const [doc, setDoc] = useState('')
  const [problemFor, setProblemFor] = useState<ReceiveRowView | null>(null)
  const [signing, setSigning] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const docs = useMemo(() => [...new Set(rows.map(r => r.doc_number).filter((d): d is string => !!d))], [rows])
  const shown = rows.filter(r => {
    if (doc && r.doc_number !== doc) return false
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return r.product_name.toLowerCase().includes(q) || (r.product_sku ?? '').toLowerCase().includes(q)
  })

  const body = buildReceiveBody(rows, state)
  const touched = body.lines.length + body.signals.length > 0

  function setRow(id: string, patch: Partial<ReceiveRowState>) {
    setState(prev => {
      const cur = prev[id] ?? { checked: false, problem: null }
      return { ...prev, [id]: { ...cur, ...patch } }
    })
  }

  function tickShown(on: boolean) {
    setState(prev => {
      const next = { ...prev }
      for (const r of shown) {
        const cur = next[r.item_id] ?? { checked: false, problem: null }
        if (!cur.problem) next[r.item_id] = { ...cur, checked: on }
      }
      return next
    })
  }

  async function sign() {
    setSigning(true)
    setError('')
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Приемането не мина')
      router.push(`/deliveries/${deliveryId}`)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setSigning(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-4 max-w-4xl pb-28">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon"><Link href={`/deliveries/${deliveryId}`} aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div>
          <h1 className="text-2xl font-bold">Получаване · {formatDeliveryNumber(number)}</h1>
          <p className="text-sm text-muted-foreground">
            Отметнете какво дойде. Неотметнатото остава да се чака. Число се пише само при „Не е наред“.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">Всичко по доставката вече е получено.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Търсене в реда" className="pl-8 bg-white" />
            </div>
            {docs.length > 1 && (
              <select className="h-10 rounded-md border border-input bg-white px-2 text-sm" value={doc} onChange={e => setDoc(e.target.value)} aria-label="Фактура">
                <option value="">Всички фактури</option>
                {docs.map(d => <option key={d} value={d}>Ф-ра {d}</option>)}
              </select>
            )}
            <Button variant="outline" onClick={() => tickShown(false)}>Махни отметките</Button>
          </div>

          <ul className="rounded-lg border bg-white divide-y">
            {shown.map(r => {
              const s = state[r.item_id]
              const problem = s?.problem ?? null
              const checked = !!s?.checked && !problem
              return (
                <li key={r.item_id} className={cn('flex flex-col gap-3 px-3 py-3 md:flex-row md:items-center', checked && 'bg-emerald-50/60', problem && 'bg-red-50/60')} data-testid="receive-row">
                  <div className="flex flex-1 min-w-0 gap-3">
                  <ProductThumb src={r.image} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium leading-tight">{r.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.supplier_name ?? '—'}{r.doc_number ? ` · ф-ра ${r.doc_number}` : ''}{!r.needs_label ? ' · без етикет' : ''}
                    </div>
                    <div className="text-sm">
                      Очакват се <span className="font-semibold">{formatQtyWithPacks(r.remaining, r.pack_size)}</span>
                      {r.received_qty > 0 && <span className="text-xs text-muted-foreground"> (от {r.quantity}, вече получени {r.received_qty})</span>}
                    </div>
                    {problem && (
                      <div className="mt-1 text-sm text-red-800">
                        {PROBLEM_LABEL[problem.kind]}
                        {problemNeedsQty(problem.kind) && `: дошли ${(problem as { qty: number }).qty} бр.`}
                        {problem.note ? ` · „${problem.note}“` : ''}
                        {problem.kind === 'partial' && <span className="text-xs text-slate-600"> (без сигнал)</span>}
                      </div>
                    )}
                  </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <RowTick state={s} text="Получено" label={`Получено: ${r.product_name}`} onChange={on => setRow(r.item_id, { checked: on })} />
                    {problem ? (
                      <Button variant="ghost" size="sm" onClick={() => setRow(r.item_id, { problem: null })}>Отмени</Button>
                    ) : (
                      <Button variant="outline" size="sm" className="text-red-700 border-red-200" onClick={() => setProblemFor(r)}>
                        <AlertTriangle className="mr-1 h-4 w-4" />Не е наред
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
            {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">Нищо не отговаря на търсенето.</li>}
          </ul>
        </>
      )}

      <div className="fixed bottom-[var(--bottom-nav-h)] left-0 right-0 lg:left-56 border-t bg-white/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-4xl flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <div className="font-medium">{userName} · {sofiaDateTime(now)}</div>
            <div className="text-muted-foreground">{touched ? receiveSummary(body) : 'Нищо не е отметнато'}</div>
          </div>
          {error && <span className="text-sm text-red-600">{error}</span>}
          <Button className="ml-auto" disabled={!touched || signing} onClick={() => setConfirmOpen(true)}>
            <PenLine className="mr-2 h-4 w-4" />Подписвам
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Подпис</DialogTitle></DialogHeader>
          <p className="text-sm">С подписа си казвате: „Получих това от доставчика.“</p>
          <p className="text-sm text-muted-foreground">{userName} · {sofiaDateTime(now)} · {receiveSummary(body)}</p>
          {body.lines.length > 0 && <p className="text-sm text-muted-foreground">Получените бройки влизат в Офис сега.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Назад</Button>
            <Button onClick={sign} disabled={signing}>{signing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Подписвам</Button>
          </div>
        </DialogContent>
      </Dialog>

      {problemFor && (
        <ProblemDialog
          row={problemFor}
          onClose={() => setProblemFor(null)}
          onSave={p => { setRow(problemFor.item_id, { problem: p, checked: false }); setProblemFor(null) }}
        />
      )}
    </div>
  )
}

function ProblemDialog({ row, onClose, onSave }: {
  row: ReceiveRowView
  onClose: () => void
  onSave: (p: ReceiveProblem) => void
}) {
  const [kind, setKind] = useState<ReceiveProblem['kind'] | null>(null)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  function save() {
    if (!kind) return setError('Изберете какво не е наред')
    const n = qty.trim() === '' ? NaN : Number(qty)
    const p = (problemNeedsQty(kind) ? { kind, qty: n, note: note.trim() || undefined } : { kind, note: note.trim() || undefined }) as ReceiveProblem
    const err = problemError(p, row.remaining)
    if (err) return setError(err)
    onSave(p)
  }

  const qtyLabel = kind === 'damaged' ? 'Колко са здрави (влизат в Офис)' : 'Колко дойдоха'

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Не е наред: {row.product_name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Очакват се {formatQtyWithPacks(row.remaining, row.pack_size)}.</p>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map(k => (
            <button key={k} type="button" onClick={() => { setKind(k); setError('') }}
              className={cn('rounded-md border px-3 py-2 text-sm text-left', kind === k ? 'border-slate-900 bg-slate-900 text-white' : 'hover:bg-slate-50')}>
              {PROBLEM_LABEL[k]}
            </button>
          ))}
        </div>
        {kind && problemNeedsQty(kind) && (
          <label className="block text-sm space-y-1">
            <span>{qtyLabel}</span>
            <Input inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ''))} autoFocus aria-label={qtyLabel} />
          </label>
        )}
        {kind && (
          <label className="block text-sm space-y-1">
            <span>Бележка{kind === 'other' ? '' : ' (по избор)'}</span>
            <Input value={note} onChange={e => setNote(e.target.value)} aria-label="Бележка" />
          </label>
        )}
        {kind === 'partial' && (
          <p className="text-xs text-muted-foreground">Останалото остава „очаква се“ за следващия колет. Не се праща сигнал.</p>
        )}
        {kind && kind !== 'partial' && (
          <p className="text-xs text-muted-foreground">Админите получават сигнал. Доставката не става „Завършена“, докато не го решат.</p>
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
