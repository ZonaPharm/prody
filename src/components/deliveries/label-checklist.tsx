'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Tag, Truck } from 'lucide-react'
import { buildLabelBody, checklistSummary, type RowState } from '@/lib/deliveries/checklist'
import { formatDeliveryNumber, formatMoney } from '@/lib/deliveries/format'
import { splitText, type LabelItem } from '@/lib/deliveries/queue'
import { cn } from '@/lib/utils'
import { ProductThumb } from './product-picker'
import { ProblemButton, ProblemDialog, ProblemText, RowTick, SignBar, postJson, rowTone } from './checklist-ui'

/**
 * "Етикетиране": one row per delivery line with received units still without a
 * label, wherever they go: the stores of the plan and Офис alike (Офис sells online
 * too). A tick says "these N units are labelled"; "Не е наред" when only part is, or
 * something is wrong. The labelled units then go by themselves to the stores that still
 * need some and are ready for the next trip; the rest stay labelled in Офис.
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

  const body = buildLabelBody(rows, state)
  const touchedRows = new Set([...body.rows.map(r => r.item_id), ...body.signals.map(s => s.item_id)]).size
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
      const data = await postJson<{ labelled: number; ready: number; signals: number }>('/api/deliveries/ready', body, 'Етикетирането не мина')
      setState({})
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
          </div>

          <ul className="rounded-lg border bg-white divide-y">
            {shown.map(r => {
              const s = state[r.item_id]
              return (
                <li key={r.item_id} className={cn('flex flex-wrap items-center gap-3 px-3 py-3', rowTone(s))} data-testid="label-row">
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
                    {s?.problem && <ProblemText step="label" problem={s.problem} />}
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/labels?title=${encodeURIComponent(r.product_name)}&text=${encodeURIComponent(formatMoney(r.product_price))}`} target="_blank">
                      <Tag className="mr-1 h-4 w-4" />Етикет
                    </Link>
                  </Button>
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
        statement="Сложих етикет на тези бройки."
        disabled={touchedRows === 0}
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
