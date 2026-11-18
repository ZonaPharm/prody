'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SectionTitle, Hint, Note, Meta, Empty } from '@/components/ui/text'
import { formatDateBg } from '@/lib/date-input'
import { cn } from '@/lib/utils'
import type { StockValue, DeadStock, WriteOffs, ReasonTotals } from '@/lib/reports/stock-money'

type Data = {
  value: StockValue
  dead: DeadStock & { days: number; cutoffDate: string }
  writeOffs: WriteOffs & { from: string; to: string }
}

const eur = (n: number, digits = 0) =>
  `${n.toLocaleString('bg-BG', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`

const units = (n: number) => `${n.toLocaleString('bg-BG')} бр.`

/** The Sofia calendar day of a timestamp, as DD.MM.YYYY. */
const day = (iso: string) => formatDateBg(new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' }))

/** „Стоката в пари“ on Отчети: money in stock, dead stock, write-offs. Admins only. */
export function StockMoneySection({ from, to }: { from: string; to: string }) {
  const [days, setDays] = useState<60 | 90>(60)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Only the latest request's answer is shown, even if an older one comes back later.
  const latest = useRef(0)
  const load = useCallback(() => {
    const id = ++latest.current
    setLoading(true)
    setError('')
    fetch(`/api/reports/stock-money?days=${days}&from=${from}&to=${to}`)
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Грешка при зареждане')
        return d
      })
      .then(d => { if (id === latest.current) setData(d) })
      .catch(e => { if (id === latest.current) setError(e instanceof Error ? e.message : 'Грешка при зареждане') })
      .finally(() => { if (id === latest.current) setLoading(false) })
  }, [days, from, to])

  useEffect(() => { load() }, [load])

  return (
    <Card data-testid="stock-money">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          Стоката в пари
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Зареждане" />}
        </CardTitle>
        <Meta>Колко пари стоят в стока, коя стока не се продава и какво е бракувано или липсва.</Meta>
      </CardHeader>
      <CardContent className="space-y-8">
        {error && <Note tone="danger">{error}</Note>}
        {!data && !error && <p className="text-sm text-muted-foreground">Зареждане...</p>}
        {data && (
          <>
            <ValueBlock value={data.value} />
            <DeadBlock dead={data.dead} days={days} setDays={setDays} />
            <WriteOffBlock off={data.writeOffs} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Money in stock ─────────────────────────────────────────────────────────

function ValueBlock({ value }: { value: StockValue }) {
  const t = value.total
  return (
    <section className="space-y-3" data-testid="stock-value">
      <SectionTitle count="сега">Колко пари има в стока</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Figure label="По покупна цена" value={eur(t.cost)} strong />
        <Figure label="По продажна цена" value={eur(t.retail)} />
        <Figure label="Бройки" value={units(t.units)} sub={`${t.products.toLocaleString('bg-BG')} продукта`} />
      </div>

      <ul className="divide-y rounded-md border">
        {value.stores.map(s => (
          <li key={s.store_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{s.store_name}</p>
              <Meta>{units(s.units)} · {s.products} продукта</Meta>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums text-slate-900">{eur(s.cost)}</p>
              <Meta>продажна {eur(s.retail)}</Meta>
            </div>
          </li>
        ))}
      </ul>

      {(t.unitsWithoutCost > 0 || t.unitsWithoutPrice > 0) && (
        <Note tone="info" small>
          {t.unitsWithoutCost > 0 && <>{units(t.unitsWithoutCost)} нямат покупна цена нито в партидата, нито в каталога, и не са в сумата по покупна цена. </>}
          {t.unitsWithoutPrice > 0 && <>{units(t.unitsWithoutPrice)} нямат продажна цена в каталога.</>}
        </Note>
      )}
    </section>
  )
}

/** A big number. The first (strong) one spans the row on a phone, the others share it. */
function Figure({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-md border px-3 py-2', strong && 'col-span-2 sm:col-span-1 border-slate-300 bg-slate-50')}>
      <Meta>{label}</Meta>
      <p className={cn('font-bold tabular-nums text-slate-900', strong ? 'text-2xl' : 'text-xl sm:text-2xl')}>{value}</p>
      {sub && <Meta>{sub}</Meta>}
    </div>
  )
}

// ─── Dead stock ─────────────────────────────────────────────────────────────

const DEAD_STEP = 20

function DeadBlock({ dead, days, setDays }: { dead: Data['dead']; days: 60 | 90; setDays: (d: 60 | 90) => void }) {
  const [shown, setShown] = useState(DEAD_STEP)
  const [store, setStoreState] = useState<string | null>(null)
  const setStore = (id: string | null) => { setStoreState(id); setShown(DEAD_STEP) }

  const rows = store ? dead.rows.filter(r => r.store_id === store) : dead.rows
  const t = dead.total

  return (
    <section className="space-y-3" data-testid="dead-stock">
      <SectionTitle
        action={
          <span className="inline-flex rounded-md border p-0.5" role="group" aria-label="Период без продажба">
            {([60, 90] as const).map(d => (
              <button
                key={d}
                type="button"
                onClick={() => { setDays(d); setShown(DEAD_STEP) }}
                aria-pressed={days === d}
                className={cn('rounded px-2.5 py-1 text-sm', days === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                {d} дни
              </button>
            ))}
          </span>
        }
      >
        Залежала стока
      </SectionTitle>
      <Hint small>
        Стока, която е в обекта поне {days} дни и през това време не е продадена там. В Офис се брои, ако не е продадена в нито един магазин.
      </Hint>

      {t.lines === 0 ? (
        <Empty>Няма стока без продажба от {days} дни.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Figure label="Стоят пари (покупна цена)" value={eur(t.cost)} strong />
            <Figure label="Бройки" value={units(t.units)} />
            <Figure label="Продукта по обекти" value={t.lines.toLocaleString('bg-BG')} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip active={store === null} onClick={() => setStore(null)}>Всички</Chip>
            {dead.byStore.map(s => (
              <Chip key={s.store_id} active={store === s.store_id} onClick={() => setStore(store === s.store_id ? null : s.store_id)}>
                {s.store_name} <span className="tabular-nums">{eur(s.cost)}</span>
              </Chip>
            ))}
          </div>

          <ul className="divide-y rounded-md border">
            {rows.slice(0, shown).map(r => (
              <li key={`${r.product_id}|${r.store_id}`} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 break-words">{r.product_name}</p>
                  <Meta>{r.store_name} · там от {day(r.since)}</Meta>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{r.cost != null ? eur(r.cost, 2) : '—'}</p>
                  <Meta>{units(r.units)}</Meta>
                </div>
              </li>
            ))}
          </ul>
          <ListFooter shown={Math.min(shown, rows.length)} total={rows.length} all={store ? undefined : t.lines} onMore={() => setShown(shown + DEAD_STEP * 2)} />

          {t.unitsWithoutCost > 0 && (
            <Note tone="info" small>{units(t.unitsWithoutCost)} от залежалата стока нямат покупна цена и не са в сумата.</Note>
          )}
        </>
      )}
    </section>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  )
}

/** "Показани 20 от 85" + a button for more. `all` is the full count when the list was cut by the server. */
function ListFooter({ shown, total, all, onMore }: { shown: number; total: number; all?: number; onMore: () => void }) {
  if (total === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Meta>
        Показани {shown} от {total}
        {all != null && all > total && <> (най-скъпите {total} от {all})</>}
      </Meta>
      {shown < total && <Button type="button" variant="outline" size="sm" onClick={onMore}>Покажи още</Button>}
    </div>
  )
}

// ─── Write-offs ─────────────────────────────────────────────────────────────

const OFF_STEP = 10

function WriteOffBlock({ off }: { off: Data['writeOffs'] }) {
  const [shown, setShown] = useState(OFF_STEP)
  const nothing = off.losses.length === 0 && off.surplus.length === 0
  const period = `${formatDateBg(off.from)} – ${formatDateBg(off.to)}`

  return (
    <section className="space-y-3" data-testid="write-offs">
      <SectionTitle count={period}>Брак и липси</SectionTitle>
      <Hint small>От корекциите на наличности за периода горе. „Грешно въвеждане“ е поправка на запис, не загуба на стока, затова не влиза в сумите.</Hint>

      {nothing ? (
        <Empty>Няма корекции на наличности за този период.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ReasonList
              title="Липсват или бракувани"
              tone="loss"
              groups={off.losses}
              total={off.lossTotal}
            />
            <ReasonList
              title="Намерени в повече"
              tone="surplus"
              groups={off.surplus}
              total={off.surplusTotal}
            />
          </div>

          {off.byStore.length > 1 && (
            <ul className="divide-y rounded-md border">
              {off.byStore.map(s => (
                <li key={s.store_id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">{s.store_name}</span>
                  <span className="tabular-nums">
                    {s.lossUnits > 0 && <span className="text-red-700">−{eur(s.lossValue, 2)} ({units(s.lossUnits)})</span>}
                    {s.lossUnits > 0 && s.surplusUnits > 0 && <span className="text-slate-400"> · </span>}
                    {s.surplusUnits > 0 && <span className="text-emerald-700">+{eur(s.surplusValue, 2)} ({units(s.surplusUnits)})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Всички корекции ({off.rows.length})</summary>
            <ul className="divide-y border-t">
              {off.rows.slice(0, shown).map(r => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 break-words">{r.product_name}</p>
                    <Meta>{r.store_name} · {day(r.created_at)} · {r.label}{r.notes ? ` · ${r.notes}` : ''}</Meta>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('text-sm font-semibold tabular-nums', r.difference < 0 ? 'text-red-700' : 'text-emerald-700')}>
                      {r.difference > 0 ? '+' : ''}{r.difference} бр.
                    </p>
                    <Meta>{r.value != null ? eur(r.value, 2) : 'без цена'}</Meta>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t px-3 py-2">
              <ListFooter shown={Math.min(shown, off.rows.length)} total={off.rows.length} onMore={() => setShown(shown + OFF_STEP * 3)} />
            </div>
          </details>
        </>
      )}
    </section>
  )
}

function ReasonList({ title, tone, groups, total }: {
  title: string
  tone: 'loss' | 'surplus'
  groups: ReasonTotals[]
  total: { units: number; value: number; unitsWithoutCost: number }
}) {
  const color = tone === 'loss' ? 'text-red-700' : 'text-emerald-700'
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <Meta>{title}</Meta>
        <span className={cn('text-xl font-bold tabular-nums', total.units ? color : 'text-slate-400')}>{eur(total.value, 2)}</span>
      </div>
      {groups.length === 0 ? (
        <Meta className="mt-1">Няма.</Meta>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {groups.map(g => (
            <li key={g.reason} className={cn('flex justify-between gap-2', !g.counted && 'text-slate-400')}>
              <span className={g.counted ? 'text-slate-700' : undefined}>
                {g.label} <span className={g.counted ? 'text-slate-500' : undefined}>· {units(g.units)}</span>
                {!g.counted && <span className="text-xs"> (не е в сумата)</span>}
              </span>
              <span className="tabular-nums">{eur(g.value, 2)}</span>
            </li>
          ))}
        </ul>
      )}
      {total.unitsWithoutCost > 0 && <Meta className="mt-1">{units(total.unitsWithoutCost)} без покупна цена, не са в сумата.</Meta>}
    </div>
  )
}
