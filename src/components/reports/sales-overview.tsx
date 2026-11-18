'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Meta, Note, Empty } from '@/components/ui/text'
import { formatDateBg } from '@/lib/date-input'
import { cn } from '@/lib/utils'
import { changePct, type SalesSummary, type Totals, type PaymentTotals } from '@/lib/reports/sales-summary'

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
        <Figure title="Касови бележки" value={num(t.receipts)}>
          <Meta>{num(t.units)} бр. продадени</Meta>
          <Change now={t.receipts} before={p.receipts} />
        </Figure>
        <Figure title="Среден чек" value={eur(t.avgReceipt, 2)}>
          <Change now={t.avgReceipt} before={p.avgReceipt} />
        </Figure>
        <Figure title="Печалба" value={eur(t.profit)}>
          <Meta>марж {pctText(t.marginPct)}</Meta>
          <Change now={t.profit} before={p.profit} />
        </Figure>
      </div>
      <Meta>
        В брой {eur(summary.payment.cash)} · с карта {eur(summary.payment.card)}
        {summary.payment.other > 0 && <> · друго {eur(summary.payment.other)}</>}
      </Meta>
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

/** Per store: money, receipts, average, profit and cash/card. A table on a computer, cards on a phone. */
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
                    <span>{num(s.receipts)} бележки</span>
                    <span className="text-right">среден чек {eur(s.avgReceipt, 2)}</span>
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
                    <th className="py-2 px-3 text-right font-medium">Бележки</th>
                    <th className="py-2 px-3 text-right font-medium">Среден чек</th>
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
                      <td className="py-2 px-3 text-right">{num(s.receipts)}</td>
                      <td className="py-2 px-3 text-right">{eur(s.avgReceipt, 2)}</td>
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
                      <td className="py-2 px-3 text-right">{num(t.receipts)}</td>
                      <td className="py-2 px-3 text-right">{eur(t.avgReceipt, 2)}</td>
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
