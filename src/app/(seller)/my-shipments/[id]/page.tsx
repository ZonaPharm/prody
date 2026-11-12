import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { isUuid } from '@/lib/deliveries/api'
import { getShipment } from '@/lib/deliveries/work'
import { formatShipmentNumber } from '@/lib/deliveries/format'
import { SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE, boxesText } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowLeft, Check, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ShipmentChecklist } from '@/components/deliveries/shipment-checklist'

export const dynamic = 'force-dynamic'

/**
 * The store's checklist for one shipment. Read with the seller's own session:
 * RLS shows only shipments of the seller's store, so another store's id is a 404.
 */
export default async function MyShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  if (!deliveriesActive()) notFound()
  const user = await requireAuth()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const shipment = await getShipment(supabase, id, { store: true })
  if (!shipment || shipment.store_id !== user.store_id) notFound()
  if (!['sent', 'received', 'received_with_issues'].includes(shipment.status)) notFound()

  const units = shipment.lines.reduce((n, l) => n + l.qty, 0)
  const got = shipment.lines.reduce((n, l) => n + (l.received_qty ?? l.qty), 0)
  const missing = units - got

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon"><Link href="/my-shipments" aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">Пратка {formatShipmentNumber(shipment.number)}</h1>
            <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', SHIPMENT_STATUS_TONE[shipment.status])}>{SHIPMENT_STATUS_LABEL[shipment.status]}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            за {shipment.store_name} · {shipment.lines.length} {shipment.lines.length === 1 ? 'ред' : 'реда'}, {units} бр.
            {shipment.box_count ? `, ${boxesText(shipment.box_count)}` : ''}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          {shipment.status === 'sent' ? (
            <ShipmentChecklist
              mode="store"
              shipmentId={shipment.id}
              number={shipment.number}
              storeName={shipment.store_name}
              lines={shipment.lines}
              userName={user.display_name}
              doneHref="/my-shipments"
            />
          ) : (
            <>
              {missing > 0 ? (
                <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div className="space-y-1">
                    <p className="font-semibold">Приета с липса: дошли {got} от {units} бр., липсват {missing}.</p>
                    <p>Във Вашата наличност са само приетите {got} бр. Администраторът вижда липсата в „Проблеми“ и решава какво става с нея. Не е нужно да правите нищо.</p>
                    <p>Ако после намерите липсващото, кажете на администратора.</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <p><b>Всичко е прието.</b> {units} бр. са във Вашата наличност и могат да се продават.</p>
                </div>
              )}
              <div className="overflow-hidden rounded-lg border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Продукт</th>
                      <th className="px-3 py-2 text-right font-medium">Изпратени</th>
                      <th className="px-3 py-2 text-right font-medium">Приети</th>
                      <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Разлика</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipment.lines.map(l => {
                      const r = l.received_qty ?? l.qty
                      return (
                        <tr key={l.id} className="border-t">
                          <td className="px-4 py-2">
                            <p className="font-medium">{l.product_name}</p>
                            {l.product_sku && <p className="text-xs text-muted-foreground">{l.product_sku}</p>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.qty}</td>
                          <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', r < l.qty && 'text-red-700')}>
                            {r}
                            {r < l.qty && <span className="block text-xs font-normal sm:hidden">липсват {l.qty - r}</span>}
                          </td>
                          <td className="hidden px-4 py-2 text-right tabular-nums sm:table-cell">
                            {r < l.qty ? <span className="text-red-700">липсват {l.qty - r}</span> : <span className="text-emerald-700">наред</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <aside className="rounded-lg border bg-white p-4 lg:sticky lg:top-6">
          <h2 className="mb-3 text-sm font-semibold">Пътят на пратката</h2>
          <ol className="space-y-3">
            <Step done={reached(shipment.status, 'packed')} title="Опакована в Офис" when={shipment.packed_at} who={shipment.packer} />
            <Step done={reached(shipment.status, 'sent')} title="Тръгнала с шофьора" when={shipment.sent_at} who={shipment.sender} note="От този момент стоката е във Вашата наличност." />
            <Step
              done={reached(shipment.status, 'received')}
              current={shipment.status === 'sent'}
              title={shipment.status === 'sent' ? 'Отметнете я тук, когато пристигне' : missing > 0 ? 'Приета в магазина, с липса' : 'Приета в магазина'}
              when={shipment.received_at}
              who={shipment.receiver}
            />
          </ol>
        </aside>
      </div>
    </div>
  )
}

const ORDER = ['packing', 'packed', 'sent', 'received']
/** Has the shipment got at least to `stage`? Both accepted statuses count as "received". */
function reached(status: string, stage: 'packed' | 'sent' | 'received') {
  const at = ORDER.indexOf(status === 'received_with_issues' ? 'received' : status)
  return at >= ORDER.indexOf(stage)
}

function Step({ done, current, title, when, who, note }: { done: boolean; current?: boolean; title: string; when: string | null; who: string | null; note?: string }) {
  return (
    <li className="flex gap-3">
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
        done ? 'border-emerald-500 bg-emerald-500 text-white' : current ? 'border-primary bg-primary/10' : 'border-slate-300 bg-white')}>
        {done && <Check className="h-3 w-3" />}
      </span>
      <div className="min-w-0 text-sm">
        <p className={cn('font-medium', !done && !current && 'text-muted-foreground')}>{title}</p>
        {when && <p className="text-xs text-muted-foreground">{sofiaDateTime(when)}{who ? ` · ${who}` : ''}</p>}
        {note && done && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </li>
  )
}
