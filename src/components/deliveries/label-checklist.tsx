'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Printer, Scissors, Search, Tag, Truck } from 'lucide-react'
import { buildLabelBody, checklistSummary, kindNeedsQty, type RowState, type Split } from '@/lib/deliveries/checklist'
import { formatDeliveryNumber, formatMoney } from '@/lib/deliveries/format'
import { defaultSplit, splitError, splitTargets, splitText, type LabelItem } from '@/lib/deliveries/queue'
import { cn } from '@/lib/utils'
import { ProductThumb } from './product-picker'
import { ProblemButton, ProblemDialog, ProblemText, RowTick, SignBar, postJson, rowTone } from './checklist-ui'

/** The label sheets for these lines (at most 300 in one go), in a new tab. */
function printHref(itemIds: string[]): string {
  return `/print/labels?items=${itemIds.slice(0, 300).join(',')}`
}

/**
 * "Етикетиране": one row per delivery line with received units still without a
 * label, wherever they go: the stores of the plan and Офис alike (Офис sells online
 * too). Printing labels marks nothing: a tick says "these N units are repacked where
 * needed and carry their labels", and then they go by themselves to the stores that
 * still need some (ready for the next trip); the rest stay labelled in Офис.
 * "Само част" when only some are done: how many, and where those go, inside the plan.
 * "Не е наред" when something is wrong.
 */
export function LabelChecklist({ rows, storeNames, userName, initialDelivery }: {
  rows: LabelItem[]
  storeNames: Record<string, string>
  userName: string
  initialDelivery?: string
}) {
  const router = useRouter()
  const [state, setState] = useState<Record<string, RowState>>({})
  const [filter, setFilter] = useState('')
  const [delivery, setDelivery] = useState(() => (initialDelivery && rows.some(r => r.delivery_id === initialDelivery) ? initialDelivery : ''))
  const [problemFor, setProblemFor] = useState<LabelItem | null>(null)
  // Where the units of a row labelled in part go: target key ('office' or store id) → text.
  const [splits, setSplits] = useState<Record<string, Record<string, string>>>({})
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const storeName = (id: string) => storeNames[id] ?? '?'

  const deliveries = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const r of rows) m.set(r.delivery_id, r.delivery_number)
    return [...m.entries()].sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
  }, [rows])

  const shown = rows.filter(r => {
    if (delivery && r.delivery_id !== delivery) return false
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return r.product_name.toLowerCase().includes(q) || (r.product_sku ?? '').toLowerCase().includes(q)
  })

  const tKey = (id: string | null) => id ?? 'office'
  /** The units of a row labelled now, when fewer than all (null: none or all). */
  const partQty = (r: LabelItem): number | null => {
    const p = state[r.item_id]?.problem
    if (!p || !kindNeedsQty(p.kind) || p.qty <= 0 || p.qty >= r.expected) return null
    return p.qty
  }
  const splitOf = (r: LabelItem, qty: number): Split => {
    const targets = splitTargets(r, storeName)
    const typed = splits[r.item_id]
    if (!typed) return defaultSplit(targets, qty)
    return targets.map(t => ({ store_id: t.store_id, qty: Number(typed[tKey(t.store_id)] || 0) })).filter(x => x.qty !== 0)
  }
  const splitBody: Record<string, Split> = {}
  const splitProblems: string[] = []
  for (const r of rows) {
    const p = state[r.item_id]?.problem
    if (p?.kind === 'partial' && p.qty >= r.expected) splitProblems.push(`${r.product_name}: готовите са под ${r.expected} бр.; ако са всички, отметнете реда`)
    const q = partQty(r)
    if (q == null) continue
    const sp = splitOf(r, q)
    splitBody[r.item_id] = sp
    const err = splitError(splitTargets(r, storeName), sp, q, storeName)
    if (err) splitProblems.push(`${r.product_name}: ${err}`)
  }

  const body = buildLabelBody(rows, state, splitBody)
  const touchedRows = new Set([...body.rows.map(r => r.item_id), ...body.signals.map(s => s.item_id)]).size
  const units = body.rows.reduce((s, r) => s + r.qty, 0)

  function setRow(id: string, patch: Partial<RowState>) {
    if ('problem' in patch) setSplits(prev => { const next = { ...prev }; delete next[id]; return next })
    setState(prev => {
      const cur = prev[id] ?? { checked: false, problem: null }
      return { ...prev, [id]: { ...cur, ...patch } }
    })
  }

  async function sign() {
    setSigning(true)
    setError('')
    try {
      const data = await postJson<{ labelled: number; ready: number; signals: number }>('/api/deliveries/ready', body, 'Етикетирането не мина')
      setState({})
      setSplits({})
      setDone(
        `Етикетирани ${data.labelled} бр.` +
          (data.ready ? `, от тях ${data.ready} бр. са готови за магазините` : '') +
          (data.signals ? `, ${data.signals} сигнала към админите` : '') + '.',
      )
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="space-y-4 pb-28">
      {done && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {done}
          <Button asChild size="sm" variant="outline" className="ml-auto"><Link href="/deliveries/trips"><Truck className="mr-2 h-4 w-4" />Към курсовете</Link></Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-white p-6 text-sm text-muted-foreground">
          Няма какво да се етикетира: всичко получено вече е с етикет, или още нищо не е получено.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Търсене на продукт" className="pl-8 bg-white" />
            </div>
            {(deliveries.length > 1 || delivery) && (
              <select className="h-10 rounded-md border border-input bg-white px-2 text-sm" value={delivery} onChange={e => setDelivery(e.target.value)} aria-label="Доставка">
                <option value="">Всички доставки</option>
                {deliveries.map(([id, n]) => <option key={id} value={id}>{formatDeliveryNumber(n)}</option>)}
              </select>
            )}
            <Button variant="outline" onClick={() => setState({})}>Махни отметките</Button>
            {shown.length > 0 && (
              <Button asChild>
                <Link href={printHref(shown.map(r => r.item_id))} target="_blank"><Printer className="mr-2 h-4 w-4" />Печат на етикетите ({shown.reduce((n, r) => n + r.expected, 0)} бр.)</Link>
              </Button>
            )}
          </div>

          <ul className="rounded-lg border bg-white divide-y">
            {shown.map(r => {
              const s = state[r.item_id]
              const part = partQty(r)
              const targets = part != null ? splitTargets(r, storeName) : []
              const sp = part != null ? splitOf(r, part) : []
              const spErr = part != null ? splitError(targets, sp, part, storeName) : null
              return (
                <li key={r.item_id} className={cn('flex flex-wrap items-center gap-3 px-3 py-3', s?.problem?.kind === 'partial' ? 'bg-amber-50/60' : rowTone(s))} data-testid="label-row">
                  <RowTick state={s} label={`Етикетирани: ${r.product_name}`} onChange={on => setRow(r.item_id, { checked: on })} />
                  <ProductThumb src={r.image} size={40} />
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium leading-tight">{r.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      <Link href={`/deliveries/${r.delivery_id}`} className="hover:underline">{formatDeliveryNumber(r.delivery_number)}</Link>
                      {r.product_sku ? ` · ${r.product_sku}` : ''}
                      {` · цена ${formatMoney(r.product_price)}`}
                      {r.labelled_qty > 0 ? ` · вече с етикет ${r.labelled_qty} от ${r.received_qty}` : ''}
                      {!r.needs_label && ' · продуктът е „Без етикет“'}
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">{r.expected} бр.</span>
                      <span className="text-muted-foreground"> → {splitText(r.split, storeName)}</span>
                    </div>
                    {s?.problem && s.problem.kind !== 'partial' && <ProblemText step="label" problem={s.problem} />}
                    {s?.problem?.kind === 'partial' && (
                      <label className="mt-1 flex items-center gap-2 text-sm text-amber-900">
                        Готови сега (преопаковани и с етикет):
                        <Input
                          type="number"
                          min={1}
                          max={r.expected - 1}
                          className="h-8 w-20 bg-white"
                          aria-label={`Готови сега: ${r.product_name}`}
                          value={s.problem.qty || ''}
                          onChange={e => setRow(r.item_id, { problem: { kind: 'partial', qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })}
                        />
                        <span className="text-muted-foreground">от {r.expected} бр.</span>
                      </label>
                    )}
                    {part != null && (
                      <div className="mt-2 rounded-md border border-amber-200 bg-white p-2 text-sm" data-testid="label-split">
                        <div className="mb-1 text-xs text-muted-foreground">Къде отиват тези {part} бр. (в рамките на плана):</div>
                        <div className="flex flex-wrap gap-3">
                          {targets.map(t => {
                            const cur = sp.find(x => x.store_id === t.store_id)?.qty ?? 0
                            return (
                              <label key={tKey(t.store_id)} className="flex items-center gap-1.5">
                                <span>{t.store_id ? storeName(t.store_id) : 'Офис'}</span>
                                <Input
                                  type="number"
                                  min={0}
                                  max={t.cap}
                                  className="h-8 w-16"
                                  aria-label={`${r.product_name} към ${t.store_id ? storeName(t.store_id) : 'Офис'}`}
                                  value={splits[r.item_id]?.[tKey(t.store_id)] ?? String(cur)}
                                  onChange={e => setSplits(prev => ({
                                    ...prev,
                                    [r.item_id]: {
                                      ...Object.fromEntries(targets.map(x => [tKey(x.store_id), String(sp.find(y => y.store_id === x.store_id)?.qty ?? 0)])),
                                      ...prev[r.item_id],
                                      [tKey(t.store_id)]: e.target.value,
                                    },
                                  }))}
                                />
                                <span className="text-xs text-muted-foreground">до {t.cap}</span>
                              </label>
                            )
                          })}
                        </div>
                        {spErr && <div className="mt-1 text-xs text-red-600">{spErr}</div>}
                      </div>
                    )}
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={printHref([r.item_id])} target="_blank">
                      <Tag className="mr-1 h-4 w-4" />Етикет
                    </Link>
                  </Button>
                  {!s?.problem && r.expected > 1 && (
                    <Button variant="outline" size="sm" onClick={() => setRow(r.item_id, { checked: false, problem: { kind: 'partial', qty: 0 } })}>
                      <Scissors className="mr-1 h-4 w-4" />Само част
                    </Button>
                  )}
                  <ProblemButton state={s} onOpen={() => setProblemFor(r)} onClear={() => setRow(r.item_id, { problem: null })} />
                </li>
              )
            })}
            {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">Нищо не отговаря на филтъра.</li>}
          </ul>
        </>
      )}

      <SignBar
        userName={userName}
        summary={touchedRows ? checklistSummary(touchedRows, units, body.signals.length) : 'Нищо не е отметнато'}
        statement="Тези бройки са преопаковани, където трябва, и са с етикет."
        disabled={touchedRows === 0 || splitProblems.length > 0}
        disabledReason={splitProblems[0]}
        error={error}
        signing={signing}
        onSign={sign}
      />

      {problemFor && (
        <ProblemDialog
          step="label"
          title={problemFor.product_name}
          expected={problemFor.expected}
          hint={`Чакат етикет ${problemFor.expected} бр.`}
          onClose={() => setProblemFor(null)}
          onSave={p => { setRow(problemFor.item_id, { problem: p, checked: false }); setProblemFor(null) }}
        />
      )}
    </div>
  )
}
