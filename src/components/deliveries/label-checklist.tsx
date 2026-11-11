'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Tag, Truck } from 'lucide-react'
import {
  buildLabelBody,
  checklistSummary,
  labelOverages,
  type RowState,
} from '@/lib/deliveries/checklist'
import { formatDeliveryNumber, formatMoney } from '@/lib/deliveries/format'
import type { LabelQueueRow } from '@/lib/deliveries/queue'
import { cn } from '@/lib/utils'
import { ProductThumb } from './product-picker'
import { ProblemButton, ProblemDialog, ProblemText, RowTick, SignBar, postJson, rowTone } from './checklist-ui'

export type LabelRowView = LabelQueueRow & { store_name: string }

/**
 * "Етикетиране": one row per "product → store" from the plans of all open
 * deliveries. The person ticks a row once those units are labelled and packed
 * for that store; "Не е наред" when only part is, or something is wrong.
 * Unticked rows stay for later. The signature makes the ticked units ready
 * for the next trip.
 */
export function LabelChecklist({ rows, userName, initialDelivery }: { rows: LabelRowView[]; userName: string; initialDelivery?: string }) {
  const router = useRouter()
  const [state, setState] = useState<Record<string, RowState>>({})
  const [filter, setFilter] = useState('')
  const [delivery, setDelivery] = useState(() => (initialDelivery && rows.some(r => r.delivery_id === initialDelivery) ? initialDelivery : ''))
  const [store, setStore] = useState('')
  const [problemFor, setProblemFor] = useState<LabelRowView | null>(null)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const deliveries = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const r of rows) m.set(r.delivery_id, r.delivery_number)
    return [...m.entries()].sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
  }, [rows])
  const stores = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.store_id, r.store_name)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'bg'))
  }, [rows])

  const shown = rows.filter(r => {
    if (delivery && r.delivery_id !== delivery) return false
    if (store && r.store_id !== store) return false
    const q = filter.trim().toLowerCase()
    if (!q) return true
    return r.product_name.toLowerCase().includes(q) || (r.product_sku ?? '').toLowerCase().includes(q)
  })

  // Rows of one delivery line sit together under the product.
  const groups = useMemo(() => {
    const out: { item_id: string; head: LabelRowView; rows: LabelRowView[] }[] = []
    for (const r of shown) {
      const last = out[out.length - 1]
      if (last && last.item_id === r.item_id) last.rows.push(r)
      else out.push({ item_id: r.item_id, head: r, rows: [r] })
    }
    return out
  }, [shown])

  const body = buildLabelBody(rows, state)
  const overages = labelOverages(rows, body)
  const touchedRows = new Set([...body.rows.map(r => r.plan_id), ...body.signals.map(s => s.plan_id)]).size
  const units = body.rows.reduce((s, r) => s + r.qty, 0)

  function setRow(id: string, patch: Partial<RowState>) {
    setState(prev => {
      const cur = prev[id] ?? { checked: false, problem: null }
      return { ...prev, [id]: { ...cur, ...patch } }
    })
  }

  async function sign() {
    setSigning(true)
    setError('')
    try {
      const data = await postJson<{ ready: number; signals: number }>('/api/deliveries/ready', body, 'Етикетирането не мина')
      setState({})
      setDone(`Готови ${data.ready} бр.${data.signals ? `, ${data.signals} сигнала към админите` : ''}.`)
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
          Няма какво да се етикетира: всичко получено и разпределено вече е готово, или още нищо не е получено.
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
            {stores.length > 1 && (
              <select className="h-10 rounded-md border border-input bg-white px-2 text-sm" value={store} onChange={e => setStore(e.target.value)} aria-label="Обект">
                <option value="">Всички обекти</option>
                {stores.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}
            <Button variant="outline" onClick={() => setState({})}>Махни отметките</Button>
          </div>

          <div className="space-y-3">
            {groups.map(g => (
              <section key={g.item_id} className="rounded-lg border bg-white">
                <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
                  <ProductThumb src={g.head.image} size={40} />
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-medium leading-tight">{g.head.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      <Link href={`/deliveries/${g.head.delivery_id}`} className="hover:underline">{formatDeliveryNumber(g.head.delivery_number)}</Link>
                      {g.head.product_sku ? ` · ${g.head.product_sku}` : ''}
                      {` · цена ${formatMoney(g.head.product_price)}`}
                      {` · в Офис без етикет ${g.head.item_free} бр.`}
                      {!g.head.needs_label && ' · без етикет'}
                    </div>
                  </div>
                  {g.head.needs_label && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/labels?title=${encodeURIComponent(g.head.product_name)}&text=${encodeURIComponent(formatMoney(g.head.product_price))}`} target="_blank">
                        <Tag className="mr-1 h-4 w-4" />Етикет
                      </Link>
                    </Button>
                  )}
                </header>
                <ul className="divide-y">
                  {g.rows.map(r => {
                    const s = state[r.plan_id]
                    return (
                      <li key={r.plan_id} className={cn('flex flex-wrap items-center gap-3 px-3 py-3', rowTone(s))} data-testid="label-row">
                        <RowTick state={s} label={`Готови: ${r.product_name} за ${r.store_name}`} onChange={on => setRow(r.plan_id, { checked: on })} />
                        <div className="flex-1 min-w-[160px]">
                          <div>
                            → <span className="font-medium">{r.store_name}</span>, <span className="font-semibold">{r.expected} бр.</span>
                            {r.expected < r.open && <span className="text-xs text-muted-foreground"> (по план чакат {r.open}, получени са по-малко)</span>}
                          </div>
                          {r.ready_qty > 0 && <div className="text-xs text-muted-foreground">вече готови {r.ready_qty} от {r.planned_qty}</div>}
                          {s?.problem && <ProblemText step="label" problem={s.problem} />}
                        </div>
                        <ProblemButton state={s} onOpen={() => setProblemFor(r)} onClear={() => setRow(r.plan_id, { problem: null })} />
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {groups.length === 0 && <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Нищо не отговаря на филтъра.</p>}
          </div>
        </>
      )}

      {overages.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          {overages.map(o => <p key={o}>{o}</p>)}
        </div>
      )}

      <SignBar
        userName={userName}
        summary={touchedRows ? checklistSummary(touchedRows, units, body.signals.length) : 'Нищо не е отметнато'}
        statement="Етикетирах и опаковах това за тези обекти."
        disabled={touchedRows === 0 || overages.length > 0}
        disabledReason={overages.length > 0 ? 'Отметнатите са повече от полученото' : undefined}
        error={error}
        signing={signing}
        onSign={sign}
      />

      {problemFor && (
        <ProblemDialog
          step="label"
          title={`${problemFor.product_name} → ${problemFor.store_name}`}
          expected={problemFor.expected}
          hint={`За ${problemFor.store_name} се очакват ${problemFor.expected} бр.`}
          onClose={() => setProblemFor(null)}
          onSave={p => { setRow(problemFor.plan_id, { problem: p, checked: false }); setProblemFor(null) }}
        />
      )}
    </div>
  )
}
