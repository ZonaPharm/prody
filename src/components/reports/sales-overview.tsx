'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Meta, Note, Empty } from '@/components/ui/text'
import { formatDateBg } from '@/lib/date-input'
import { cn } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { changePct, type SalesSummary, type Totals, type PaymentTotals, type VoidedSummary } from '@/lib/reports/sales-summary'

export type Previous = { from: string; to: string; totals: Totals; payment: PaymentTotals }

const eur = (n: number, digits = 0) =>
  `${n.toLocaleString('bg-BG', { minimumFractionDigits: digits, maximumFractionDigits: digits })}\u00a0€`
const num = (n: number) => n.toLocaleString('bg-BG')
const pctText = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('bg-BG', { maximumFractionDigits: 1 })}%`)

/** "+12%" green / "−8%" red against the previous period; nothing when there is nothing to compare. */
function Change({ now, before }: { now: number; before: number }) {
  const c = changePct(now, before)
  if (c == null) return <Meta>няма данни за предходния период</Meta>
  const up = c > 0
  return (
    <p className="text-xs">
      <span className={cn('font-medium', c === 0 ? 'text-slate-500' : up ? 'text-emerald-700' : 'text-red-700')}>
        {up ? '+' : c < 0 ? '−' : ''}{Math.abs(c).toLocaleString('bg-BG', { maximumFractionDigits: 1 })}%
      </span>
      <span className="text-slate-500"> спрямо предходния период</span>
    </p>
  )
}

function Figure({ title, value, children }: { title: string; value: string; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm font-medium">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {children}
      </CardContent>
    </Card>
  )
}

/** The four headline numbers, each against the period of the same length right before. */
export function SummaryCards({ summary, previous }: { summary: SalesSummary; previous: Previous }) {
  const t = summary.totals
  const p = previous.totals
  return (
    <div className="space-y-2" data-testid="summary-cards">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Figure title="Оборот" value={eur(t.revenue)}>
          <Change now={t.revenue} before={p.revenue} />
        </Figure>
        <Figure title="Печалба" value={eur(t.profit)}>
          <Meta>марж {pctText(t.marginPct)}</Meta>
          <Change now={t.profit} before={p.profit} />
        </Figure>
        <Figure title="Продадени бройки" value={num(t.units)}>
          <Meta>{num(summary.uniqueProducts)} различни продукта</Meta>
          <Change now={t.units} before={p.units} />
        </Figure>
        <Figure title="В брой" value={eur(summary.payment.cash)}>
          <Meta>
            с карта {eur(summary.payment.card)}
            {summary.payment.other > 0 && <> · друго {eur(summary.payment.other)}</>}
          </Meta>
        </Figure>
      </div>
      <Meta>Сравнението е с {formatDateBg(previous.from)} – {formatDateBg(previous.to)}, същия брой дни преди периода.</Meta>
      {t.costCoverage != null && t.costCoverage < 100 && (
        <Note tone="info" small>
          Печалбата е сметната за {pctText(t.costCoverage)} от оборота ({eur(t.revenueWithCost)}). За останалите продажби не е
          известна покупната цена: нито партидата, нито каталогът я имат.
        </Note>
      )}
    </div>
  )
}

/** Per store: money, profit and cash/card. A table on a computer, cards on a phone. */
export function StoresTable({ summary }: { summary: SalesSummary }) {
  const rows = summary.byStore
  const t = summary.totals
  return (
    <Card data-testid="stores-table">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">По обекти</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty>Няма продажби за периода.</Empty> : (
          <>
            {/* Phone */}
            <ul className="divide-y rounded-md border md:hidden">
              {rows.map(s => (
                <li key={s.store_id} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-slate-900">{s.store_name}</span>
                    <span className="font-semibold tabular-nums">{eur(s.revenue)}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-slate-600">
                    <span>печалба {eur(s.profit)}</span>
                    <span className="text-right">марж {pctText(s.marginPct)}</span>
                    <span>в брой {eur(s.payment.cash)}</span>
                    <span className="text-right">с карта {eur(s.payment.card)}</span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Computer */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Обект</th>
                    <th className="py-2 px-3 text-right font-medium">Оборот</th>
                    <th className="py-2 px-3 text-right font-medium">Печалба</th>
                    <th className="py-2 px-3 text-right font-medium">Марж</th>
                    <th className="py-2 px-3 text-right font-medium">В брой</th>
                    <th className="py-2 pl-3 text-right font-medium">С карта</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map(s => (
                    <tr key={s.store_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-900">{s.store_name}</td>
                      <td className="py-2 px-3 text-right font-semibold">{eur(s.revenue)}</td>
                      <td className="py-2 px-3 text-right">{eur(s.profit)}</td>
                      <td className="py-2 px-3 text-right">{pctText(s.marginPct)}</td>
                      <td className="py-2 px-3 text-right">{eur(s.payment.cash)}</td>
                      <td className="py-2 pl-3 text-right">{eur(s.payment.card)}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 1 && (
                  <tfoot className="tabular-nums">
                    <tr className="border-t-2 font-semibold">
                      <td className="py-2 pr-3">Общо</td>
                      <td className="py-2 px-3 text-right">{eur(t.revenue)}</td>
                      <td className="py-2 px-3 text-right">{eur(t.profit)}</td>
                      <td className="py-2 px-3 text-right">{pctText(t.marginPct)}</td>
                      <td className="py-2 px-3 text-right">{eur(summary.payment.cash)}</td>
                      <td className="py-2 pl-3 text-right">{eur(summary.payment.card)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** The ten products that brought the most profit in the period. */
export function TopProfit({ summary }: { summary: SalesSummary }) {
  return (
    <Card data-testid="top-profit">
      <CardHeader><CardTitle className="text-base">Най-печеливши продукти</CardTitle></CardHeader>
      <CardContent>
        {summary.topByProfit.length === 0 ? <Empty>Няма продажби с известна покупна цена.</Empty> : (
          <ol className="divide-y">
            {summary.topByProfit.map((p, i) => (
              <li key={p.product_id} className="flex items-start justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 break-words"><span className="text-slate-400 tabular-nums">{i + 1}.</span> {p.name}</p>
                  <Meta>{num(p.units)} бр. · оборот {eur(p.revenue)}</Meta>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{eur(p.profit ?? 0)}</p>
                  <Meta>марж {pctText(p.marginPct)}</Meta>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

/** Per seller: takings and units sold; and the voided sales of the period. */
export function SellersCard({ summary, voided }: { summary: SalesSummary; voided?: VoidedSummary }) {
  const rows = summary.bySeller
  const voidedBy = new Map((voided?.bySeller || []).map(v => [v.name, v]))
  return (
    <Card data-testid="sellers">
      <CardHeader className="pb-3"><CardTitle className="text-base">По продавачи</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? <Empty>Няма продажби за периода.</Empty> : (
          <ul className="divide-y rounded-md border">
            {rows.map(r => {
              const v = voidedBy.get(r.name)
              return (
                <li key={r.sold_by} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 break-words">{r.name}</p>
                    <Meta>
                      {num(r.units)} бр. продадени
                      {v && <span className="text-red-700"> · анулирани {v.rows} за {eur(v.value, 2)}</span>}
                    </Meta>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{eur(r.revenue)}</span>
                </li>
              )
            })}
          </ul>
        )}
        {voided && (
          voided.rows === 0
            ? <Meta>Няма анулирани продажби за периода.</Meta>
            : (
              <Note tone="warn" small>
                Анулирани продажби: {num(voided.rows)} {voided.rows === 1 ? 'ред' : 'реда'} ({num(voided.units)} бр.) за {eur(voided.value, 2)}.
                {' '}Те не са в оборота.
              </Note>
            )
        )}
      </CardContent>
    </Card>
  )
}

/** Which weekdays and hours sell most, Sofia time. */
export function WhenCard({ summary }: { summary: SalesSummary }) {
  const { weekdays, hours } = summary.when
  const short = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']
  const dayData = weekdays.map(d => ({ ...d, short: short[d.day] }))
  const best = [...weekdays].sort((a, b) => b.avgRevenue - a.avgRevenue)[0]
  const busiest = [...hours].sort((a, b) => b.revenue - a.revenue)[0]
  const empty = hours.length === 0 && weekdays.every(d => d.revenue === 0)
  return (
    <Card data-testid="when-sold">
      <CardHeader className="pb-3"><CardTitle className="text-base">Кога се продава</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {empty ? <Empty>Няма продажби за периода.</Empty> : (
          <>
            <div>
              <Meta>Среден оборот за ден от седмицата{best && best.avgRevenue > 0 ? ` · най-силен: ${best.label.toLowerCase()}` : ''}</Meta>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={dayData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="short" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v) => `${v} €`} />
                  <Tooltip
                    labelFormatter={(_l, p: any) => p?.[0]?.payload?.label ?? ''}
                    formatter={(v: any, _n: any, p: any) => [`${Number(v).toFixed(0)} € средно (${p?.payload?.occurrences ?? 0} дни)`, 'Оборот']}
                  />
                  <Bar dataKey="avgRevenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {hours.length > 0 && (
              <div>
                <Meta>Оборот по часове за целия период{busiest ? ` · най-много: ${busiest.hour}:00–${busiest.hour + 1}:00` : ''}</Meta>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={hours} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v) => `${v} €`} />
                    <Tooltip
                      labelFormatter={(h: any) => `${h}:00–${Number(h) + 1}:00`}
                      formatter={(v: any) => [`${Number(v).toFixed(0)} €`, 'Оборот']}
                    />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
