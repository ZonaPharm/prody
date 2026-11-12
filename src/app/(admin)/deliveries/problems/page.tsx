import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { getProblems } from '@/lib/deliveries/work'
import {
  SIGNAL_REASON_LABEL,
  SIGNAL_RESOLUTION_LABEL,
  SIGNAL_STEP_LABEL,
  formatDeliveryNumber,
  formatShipmentNumber,
  type SignalReason,
} from '@/lib/deliveries/format'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { ResolveButton } from '@/components/deliveries/resolve-dialog'
import { Empty, PageHeader } from '@/components/ui/text'

export const dynamic = 'force-dynamic'

/**
 * "Проблеми": every "Не е наред" from every step, newest first, with who
 * raised it and who signed along the way. An admin resolves each one with a
 * decision and a signature; a delivery cannot complete while one is open.
 */
export default async function ProblemsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireDeliveriesAdmin()
  const sp = await searchParams
  const filter = sp.filter === 'all' ? 'all' : 'open'
  const supabase = await createServerSupabaseClient()
  const rows = await getProblems(supabase, filter)
  const open = filter === 'open' ? rows.length : rows.filter(r => r.status === 'open').length

  return (
    <div className="space-y-4 max-w-7xl">
      <DeliveriesTabs active="problems" problems={open} />
      <PageHeader
        title="Проблеми"
        intro="Всичко отбелязано с „Не е наред“ при получаване, етикетиране, опаковане и в магазините."
        actions={
        <div className="inline-flex rounded-md border bg-white p-0.5">
          {([['open', 'Отворени'], ['all', 'Всички']] as const).map(([v, label]) => (
            <Link key={v} href={v === 'open' ? '/deliveries/problems' : '/deliveries/problems?filter=all'}
              className={cn('px-3 py-1 text-sm rounded', filter === v ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100')}>
              {label}
            </Link>
          ))}
        </div>}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-white"><Empty>{filter === 'open' ? 'Няма отворени проблеми.' : 'Няма проблеми.'}</Empty></div>
      ) : (
        <ul className="rounded-lg border bg-white divide-y">
          {rows.map(r => {
            const title = `${SIGNAL_REASON_LABEL[r.reason as SignalReason] ?? r.reason}${r.product_name ? `, ${r.product_name}` : ''}`
            return (
              <li key={r.id} className="px-4 py-3 text-sm space-y-1" data-testid="problem-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs',
                    r.status === 'open' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200')}>
                    {r.status === 'open' ? 'Отворен' : 'Решен'}
                  </span>
                  <span className="font-medium">{SIGNAL_REASON_LABEL[r.reason as SignalReason] ?? r.reason}</span>
                  <span className="text-slate-600">· {SIGNAL_STEP_LABEL[r.step] ?? r.step}</span>
                  {r.product_name && <span>· {r.product_name}</span>}
                  {r.status === 'open' && <span className="ml-auto"><ResolveButton signalId={r.id} step={r.step} title={title} userName={user.display_name} /></span>}
                </div>
                <div className="text-slate-600 flex flex-wrap gap-x-3">
                  {r.delivery_id && <Link href={`/deliveries/${r.delivery_id}`} className="underline">{formatDeliveryNumber(r.delivery_number)}</Link>}
                  {r.shipment_id && r.trip_id && (
                    <Link href={`/deliveries/trips/${r.trip_id}`} className="underline">{formatShipmentNumber(r.shipment_number)}{r.store_name ? ` → ${r.store_name}` : ''}</Link>
                  )}
                  {(r.qty_expected != null || r.qty_actual != null) && <span>очаквани {r.qty_expected ?? '—'} бр., реално {r.qty_actual ?? '—'} бр.</span>}
                </div>
                {r.note && <div className="text-slate-600">„{r.note}“</div>}
                <div className="text-xs text-slate-500">
                  Подаден от {r.creator ?? '—'}, {sofiaDateTime(r.created_at)}
                  {r.signed.length > 0 && <> · по пътя: {r.signed.map(s => `${s.step} ${s.name}`).join(', ')}</>}
                </div>
                {r.status === 'resolved' && (
                  <div className="text-xs text-emerald-800">
                    Решен от {r.resolver ?? '—'}{r.resolved_at ? `, ${sofiaDateTime(r.resolved_at)}` : ''}: {SIGNAL_RESOLUTION_LABEL[r.resolution ?? ''] ?? r.resolution}
                    {r.resolution_note ? ` · ${r.resolution_note}` : ''}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
