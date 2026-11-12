'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Loader2, PackagePlus, Search, Store, Package, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  RUNOUT_DAYS, SALES_DAYS, overOffice, paceText, reasonText, rowTab, sendPlan,
  type LowReason, type LowRow, type LowTab, type SendLine,
} from '@/lib/deliveries/low-stock'
import { formatTripNumber } from '@/lib/deliveries/format'
import { ChecklistSteps, postJson } from './checklist-ui'

export type LowRowView = LowRow & { fast: boolean }
export type OpenTrip = { id: string; number: number; planned_date: string | null; stores: string[] }

type View = 'store' | 'product'
type Picked = Record<string, string>
type SendResult = { store: string; ok: boolean; text: string }

const keyOf = (r: Pick<LowRow, 'store_id' | 'product_id'>) => `${r.store_id}|${r.product_id}`

const REASON_TONE: Record<LowReason, string> = {
  out: 'bg-red-100 text-red-800',
  under_min: 'bg-amber-100 text-amber-900',
  runs_out: 'bg-sky-100 text-sky-900',
}

const TABS: { key: LowTab; label: string; hint: string }[] = [
  { key: 'send', label: 'Има в Офис', hint: 'Може да тръгне веднага' },
  { key: 'order', label: 'Няма в Офис', hint: 'За поръчка от доставчик' },
  { key: 'coming', label: 'Вече идва', hint: 'В курс или заявено' },
]

function shortDate(d: string | null): string {
  if (!d) return ''
  const [, m, day] = d.split('-')
  return day && m ? `${day}.${m}` : d
}

/**
 * Ниски наличности: the stores' low rows, by store or by product, with what Офис
 * can send now. Ticking rows and "Изпрати от Офис" puts them into a trip through
 * „Добави от Офис“ (POST /api/deliveries/trips/office, one store per request).
 */
export function LowStockBoard({ rows, officeFree, office, trips, sales }: {
  rows: LowRowView[]
  officeFree: Record<string, number>
  office: Record<string, number>
  trips: OpenTrip[]
  /** Администратор: sales pace is shown. Офис: no sales numbers. */
  sales: boolean
}) {
  const router = useRouter()
  const counts = useMemo(() => {
    const c: Record<LowTab, number> = { send: 0, order: 0, coming: 0 }
    for (const r of rows) c[rowTab(r)]++
    return c
  }, [rows])
  const [tab, setTab] = useState<LowTab>(counts.send > 0 ? 'send' : counts.order > 0 ? 'order' : 'coming')
  const [view, setView] = useState<View>('store')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Picked>({})
  const [dialog, setDialog] = useState(false)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => rowTab(r) === tab && (!q
      || r.product_name.toLowerCase().includes(q)
      || (r.sku ?? '').toLowerCase().includes(q)
      || r.store_name.toLowerCase().includes(q)))
  }, [rows, tab, search])

  const groups = useMemo(() => {
    const m = new Map<string, { id: string; title: string; sub: string | null; rows: LowRowView[] }>()
    for (const r of visible) {
      const id = view === 'store' ? r.store_id : r.product_id
      const g = m.get(id) ?? {
        id,
        title: view === 'store' ? r.store_name : r.product_name,
        sub: view === 'store' ? null : r.sku,
        rows: [],
      }
      g.rows.push(r)
      m.set(id, g)
    }
    const list = [...m.values()]
    if (view === 'store') list.sort((a, b) => a.title.localeCompare(b.title, 'bg'))
    return list
  }, [visible, view])

  const lines: SendLine[] = useMemo(() => Object.entries(picked).map(([k, v]) => {
    const [store_id, product_id] = k.split('|')
    return { store_id, product_id, qty: Math.floor(Number(v) || 0) }
  }), [picked])
  const plan = useMemo(() => sendPlan(lines), [lines])
  const over = useMemo(() => overOffice(lines, officeFree), [lines, officeFree])
  const units = plan.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.qty, 0), 0)
  const byKey = useMemo(() => new Map(rows.map(r => [keyOf(r), r])), [rows])
  const productName = (pid: string) => rows.find(r => r.product_id === pid)?.product_name ?? 'продукт'
  const storeName = (sid: string) => rows.find(r => r.store_id === sid)?.store_name ?? 'магазин'
  const badQty = lines.some(l => l.qty <= 0)

  function toggle(r: LowRowView, on: boolean) {
    setPicked(p => {
      const next = { ...p }
      if (on) next[keyOf(r)] = String(r.suggest || 1)
      else delete next[keyOf(r)]
      return next
    })
  }

  function pickAll(list: LowRowView[]) {
    setPicked(p => {
      const next = { ...p }
      for (const r of list) if (r.suggest > 0 && !next[keyOf(r)]) next[keyOf(r)] = String(r.suggest)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Ниски наличности</h1>
        <p className="text-sm text-muted-foreground">
          Продукти под „Мин. количество“, които магазинът е продавал през последните {SALES_DAYS} дни
          или ще свършат до {RUNOUT_DAYS} дни. Изпратете от Офис, преди магазинът да е свършил.
        </p>
      </div>

      <ChecklistSteps steps={[
        <>Вижте <b>по магазин</b> или <b>по продукт</b> какво е ниско и колко има в Офис.</>,
        <>Отметнете какво да тръгне. Бройката е <b>предложена</b>; може да я промените.</>,
        <><b>„Изпрати от Офис“</b> го слага в курс. После в курса натиснете „Опаковай“.</>,
      ]} />

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Какво да се види">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn(
              'rounded-xl border p-2.5 text-left transition-colors sm:p-3',
              tab === t.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-white hover:bg-slate-50',
            )}>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold leading-tight">{t.label}</span>
              <span className={cn('text-lg font-bold tabular-nums', t.key === 'send' && counts.send > 0 ? 'text-primary' : 'text-slate-700')}>{counts[t.key]}</span>
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground leading-tight">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-white p-0.5" role="group" aria-label="Групиране">
          {([['store', 'По магазин', Store], ['product', 'По продукт', Package]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm',
                view === v ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100')}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Търси продукт или магазин"
            className="h-10 pl-8" aria-label="Търси" />
        </div>
      </div>

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-muted-foreground">
          {search ? 'Нищо не отговаря на търсенето.'
            : tab === 'send' ? <>Нищо ниско, което да има свободно в Офис.{counts.order > 0 && <> Вижте <button className="font-medium text-primary underline" onClick={() => setTab('order')}>„Няма в Офис“</button> за поръчка.</>}</>
            : tab === 'order' ? 'Всичко ниско има в Офис или вече идва.'
            : 'Нищо не е на път към магазините.'}
        </div>
      )}

      <div className={cn('grid gap-4', groups.length > 1 && 'xl:grid-cols-2')}>
        {groups.map(g => {
          const sendable = g.rows.filter(r => r.suggest > 0)
          const allPicked = sendable.length > 0 && sendable.every(r => picked[keyOf(r)])
          const free = view === 'product' ? officeFree[g.id] ?? 0 : null
          return (
            <section key={g.id} className="overflow-hidden rounded-xl border bg-white">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{g.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {view === 'store'
                      ? `${g.rows.length} ${g.rows.length === 1 ? 'продукт' : 'продукта'}`
                      : <>{g.sub ? `${g.sub} · ` : ''}Офис: {office[g.id] ?? 0} бр., свободни <b className="text-slate-700">{free}</b> · {g.rows.length} {g.rows.length === 1 ? 'магазин' : 'магазина'}
                        {tab === 'order' && <> · за поръчка общо <b className="text-slate-700">~{g.rows.reduce((n, r) => n + r.need, 0)} бр.</b></>}</>}
                  </p>
                </div>
                {tab === 'send' && sendable.length > 0 && !allPicked && (
                  <Button size="sm" variant="outline" onClick={() => pickAll(g.rows)}>
                    <Check className="mr-1 h-4 w-4" />Отметни предложеното
                  </Button>
                )}
              </header>
              <ul className="divide-y">
                {g.rows.map(r => (
                  <LowRowItem key={keyOf(r)} r={r} view={view} tab={tab} sales={sales}
                    free={officeFree[r.product_id] ?? 0} onHand={office[r.product_id] ?? 0}
                    value={picked[keyOf(r)]}
                    onToggle={on => toggle(r, on)}
                    onQty={v => setPicked(p => ({ ...p, [keyOf(r)]: v }))} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {lines.length > 0 && (
        <div className="fixed bottom-[var(--bottom-nav-h)] left-0 right-0 lg:left-56 z-20 border-t bg-white/95 px-4 py-2.5 backdrop-blur">
          {over.length > 0 && (
            <p className="max-w-7xl pb-2 text-sm text-red-700">
              Повече от свободното в Офис: {over.map(productName).join(', ')}. Намалете бройките.
            </p>
          )}
          <div className="flex max-w-7xl items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-medium">{lines.length} {lines.length === 1 ? 'ред' : 'реда'} · {units} бр.</div>
              <div className="truncate text-muted-foreground">за {plan.map(p => storeName(p.store_id)).join(', ')}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPicked({})} aria-label="Изчисти избраното">
              <X className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Изчисти</span>
            </Button>
            <Button disabled={over.length > 0 || badQty} onClick={() => setDialog(true)}>
              <PackagePlus className="mr-2 h-4 w-4" />Изпрати от Офис
            </Button>
          </div>
        </div>
      )}

      {dialog && (
        <SendDialog
          plan={plan}
          trips={trips}
          storeName={storeName}
          productName={productName}
          onClose={() => setDialog(false)}
          onSent={sentStores => {
            setPicked(p => Object.fromEntries(Object.entries(p).filter(([k]) => !sentStores.includes(k.split('|')[0]))))
            router.refresh()
          }}
          rowFor={(sid, pid) => byKey.get(`${sid}|${pid}`)}
        />
      )}
    </div>
  )
}

function LowRowItem({ r, view, tab, sales, free, onHand, value, onToggle, onQty }: {
  r: LowRowView
  view: View
  tab: LowTab
  sales: boolean
  free: number
  onHand: number
  value: string | undefined
  onToggle: (on: boolean) => void
  onQty: (v: string) => void
}) {
  const checked = value !== undefined
  const title = view === 'store' ? r.product_name : r.store_name
  const sub = view === 'store' ? r.sku : null
  const facts: string[] = [`в магазина ${r.qty} бр.`, `мин. ${r.min}`]
  if (sales) facts.push(paceText(r.sold))
  else if (r.fast) facts.push('продава се бързо')
  if (r.on_trip > 0) facts.push(`идва ${r.on_trip} в курс`)
  if (r.requested > 0) facts.push(`заявено ${r.requested}`)
  const officeText = view === 'store'
    ? (free > 0 ? `Офис: свободни ${free}` : onHand > 0 ? `Офис: ${onHand} бр., но са заети` : 'Офис: няма')
    : null

  return (
    <li className={cn('flex items-start gap-3 px-3 py-3', checked && 'bg-emerald-50/60')}>
      {tab === 'send' && (
        <Checkbox checked={checked} onCheckedChange={v => onToggle(!!v)} className="mt-1 h-6 w-6 rounded-md"
          aria-label={`Изпрати ${r.product_name} за ${r.store_name}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium leading-snug">{title}</span>
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', REASON_TONE[r.reason])}>
            {reasonText(r, { sales })}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{facts.join(' · ')}</p>
        {officeText && tab !== 'coming' && <p className="text-sm text-slate-700">{officeText}</p>}
        {tab === 'order' && <p className="text-sm text-slate-700">За поръчка: ~{r.need} бр., за да има {r.target} в магазина.</p>}
        {tab === 'send' && r.suggest < r.need && (
          <p className="text-xs text-amber-700">Трябват {r.need}; в Офис стигат за {r.suggest}, останалото е за поръчка.</p>
        )}
      </div>
      {tab === 'send' && (
        <div className="shrink-0 text-right">
          {checked ? (
            <label className="block">
              <span className="sr-only">Бройки</span>
              <Input type="number" inputMode="numeric" min={1} max={free} value={value}
                onChange={e => onQty(e.target.value)} className="h-10 w-20 text-right tabular-nums" />
              <span className="mt-0.5 block text-xs text-muted-foreground">бр.</span>
            </label>
          ) : (
            <button onClick={() => onToggle(true)} className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-slate-50">
              <span className="block text-xs text-muted-foreground">Предложено</span>
              <span className="font-semibold tabular-nums">{r.suggest} бр.</span>
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function SendDialog({ plan, trips, storeName, productName, rowFor, onClose, onSent }: {
  plan: { store_id: string; lines: { product_id: string; qty: number }[] }[]
  trips: OpenTrip[]
  storeName: (id: string) => string
  productName: (id: string) => string
  rowFor: (storeId: string, productId: string) => LowRowView | undefined
  onClose: () => void
  onSent: (stores: string[]) => void
}) {
  const [choice, setChoice] = useState<string>('new')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<SendResult[] | null>(null)
  const [trip, setTrip] = useState<{ id: string; number: number } | null>(null)

  async function send() {
    setSending(true)
    const out: SendResult[] = []
    const sent: string[] = []
    let tripId: string | null = choice === 'new' ? null : choice
    let tripInfo: { id: string; number: number } | null = null
    // One store per request; after the first, the same trip for the rest.
    for (const p of plan) {
      try {
        const res = await postJson<{ trip_id: string; trip_number: number; units: number; reopened?: boolean }>(
          '/api/deliveries/trips/office',
          { trip_id: tripId, store_id: p.store_id, lines: p.lines },
          'Не беше добавено',
        )
        tripId = res.trip_id
        tripInfo = { id: res.trip_id, number: res.trip_number }
        sent.push(p.store_id)
        out.push({ store: storeName(p.store_id), ok: true, text: `${res.units} бр.${res.reopened ? ', пратката е отворена за ново опаковане' : ''}` })
      } catch (e) {
        out.push({ store: storeName(p.store_id), ok: false, text: e instanceof Error ? e.message : 'Грешка' })
      }
    }
    setResults(out)
    setTrip(tripInfo)
    setSending(false)
    if (sent.length > 0) onSent(sent)
  }

  return (
    <Dialog open onOpenChange={o => { if (!o && !sending) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Изпрати от Офис</DialogTitle></DialogHeader>

        {!results ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {plan.map(p => (
                <div key={p.store_id} className="rounded-lg border p-2.5 text-sm">
                  <div className="font-semibold">{storeName(p.store_id)}</div>
                  <ul className="mt-1 space-y-0.5 text-slate-700">
                    {p.lines.map(l => (
                      <li key={l.product_id} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{rowFor(p.store_id, l.product_id)?.product_name ?? productName(l.product_id)}</span>
                        <span className="shrink-0 tabular-nums">{l.qty} бр.</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">В кой курс?</legend>
              <TripOption id="new" choice={choice} onChoose={setChoice} title="Нов курс"
                sub="Шофьор и ден избирате после в курса." />
              {trips.map(t => (
                <TripOption key={t.id} id={t.id} choice={choice} onChoose={setChoice}
                  title={`${formatTripNumber(t.number)}${t.planned_date ? ` · ${shortDate(t.planned_date)}` : ''}`}
                  sub={t.stores.length ? t.stores.join(', ') : 'Още без магазини'} />
              ))}
            </fieldset>

            <p className="text-xs text-muted-foreground">
              Стоката остава в Офис, докато шофьорът подпише. Магазинът я приема с пратката.
              Ако пратката за магазина вече е опакована, тя се отваря за ново опаковане.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={sending}>Отказ</Button>
              <Button onClick={send} disabled={sending}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
                Изпрати
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {results.map(r => (
                <li key={r.store} className={cn('flex items-start gap-2 rounded-lg p-2', r.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800')}>
                  {r.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span><b>{r.store}</b>: {r.text}</span>
                </li>
              ))}
            </ul>
            {trip && (
              <Link href={`/deliveries/trips/${trip.id}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-sm hover:opacity-95">
                <span>
                  <span className="block text-xs uppercase tracking-wide opacity-75">Следваща стъпка</span>
                  <span className="block text-base font-semibold">Опаковай в {formatTripNumber(trip.number)}</span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0" />
              </Link>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>Затвори</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TripOption({ id, choice, onChoose, title, sub }: {
  id: string; choice: string; onChoose: (id: string) => void; title: string; sub: string
}) {
  const on = choice === id
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-2.5', on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-slate-50')}>
      <input type="radio" name="trip" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked={on} onChange={() => onChoose(id)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </label>
  )
}
