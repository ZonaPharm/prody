'use client'

import { useMemo, useState } from 'react'
import { LABEL_KIND_LABEL } from '@/lib/label-kind'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { deliveryJourney } from '@/lib/deliveries/journey'
import type { DeliveryDetail, DetailItem } from '@/lib/deliveries/queries'
import {
  SIGNAL_REASON_LABEL,
  SIGNAL_RESOLUTION_LABEL,
  SIGNAL_STEP_LABEL,
  eventText,
  formatDeliveryNumber,
  formatMoney,
  formatQtyWithPacks,
  type SignalReason,
} from '@/lib/deliveries/format'
import { sofiaDate, sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { DeliveryStatusBadge } from './status-badge'
import { ProductThumb } from './product-picker'
import { PlanEditor, planNumbers, type PlanText } from './plan-editor'
import { ResolveButton } from './resolve-dialog'
import { NextStep, StepTrail } from './step-trail'
import { WhereIsIt } from './where-is-it'
import { whereabouts } from '@/lib/deliveries/track'

type StoreOption = { id: string; name: string; is_warehouse: boolean }
type Tab = 'lines' | 'log' | 'problems'

/**
 * A saved delivery: its lines as they stand now ("Редове"), who did what and
 * when ("Дневник"), and what was flagged ("Проблеми"). Receiving opens its own
 * checklist page.
 */
export function DeliveryView({ delivery, stores, userName }: { delivery: DeliveryDetail; stores: StoreOption[]; userName: string }) {
  const [tab, setTab] = useState<Tab>('lines')
  const [cancelOpen, setCancelOpen] = useState(false)
  const storeName = useMemo(() => new Map(stores.map(s => [s.id, s.name])), [stores])
  const shopStores = stores.filter(s => !s.is_warehouse)
  const warehouseName = stores.find(s => s.is_warehouse)?.name ?? 'Офис'
  const itemName = useMemo(() => new Map(delivery.items.map(i => [i.id, i.product_name])), [delivery.items])

  const open = delivery.status === 'expected' || delivery.status === 'in_progress'
  const units = delivery.items.reduce((s, i) => s + i.quantity, 0)
  const received = delivery.items.reduce((s, i) => s + i.received_qty, 0)
  const value = delivery.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)
  const waiting = units - received
  const openSignals = delivery.signals.filter(s => s.status === 'open').length
  const journey = deliveryJourney(delivery)

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon"><Link href="/deliveries" aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{formatDeliveryNumber(delivery.number)}</h1>
              <DeliveryStatusBadge status={delivery.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              Създадена {sofiaDate(delivery.created_at)}{delivery.creator ? ` от ${delivery.creator}` : ''}
              {delivery.order_ref ? ` · поръчка ${delivery.order_ref}` : ''}
            </p>
            {delivery.notes && <p className="text-sm mt-1">{delivery.notes}</p>}
            {delivery.status === 'cancelled' && delivery.cancel_reason && (
              <p className="text-sm text-red-700 mt-1">Отказана: {delivery.cancel_reason}</p>
            )}
          </div>
        </div>
        {open && <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>Откажи доставката</Button>}
      </div>

      {delivery.status !== 'cancelled' && (
        <div className="space-y-2">
          <StepTrail steps={journey.steps} />
          <NextStep next={journey.next} doneText={journey.finished ? 'Всичко по тази доставка е минало: получено, с етикет и изпратено.' : undefined} />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Редове" value={String(delivery.items.length)} />
        <Stat label="Бройки" value={String(units)} />
        <Stat label="Получени" value={`${received}`} hint={units ? `${Math.round((received / units) * 100)}%` : undefined} />
        <Stat label="Чакат" value={String(waiting)} />
        <Stat label="Стойност" value={formatMoney(value)} />
      </div>

      {openSignals > 0 && (
        <button type="button" onClick={() => setTab('problems')}
          className="w-full rounded-md border border-red-200 bg-red-50 p-3 text-left text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {openSignals === 1 ? '1 отворен проблем' : `${openSignals} отворени проблема`}. Доставката не може да е „Завършена“, докато не бъдат решени.
        </button>
      )}

      <div className="no-scrollbar flex max-w-full overflow-x-auto rounded-md border bg-white p-0.5 sm:inline-flex">
        {([
          ['lines', `Къде е стоката (${delivery.items.length})`],
          ['log', `Дневник (${delivery.events.length})`],
          ['problems', `Проблеми (${delivery.signals.length})`],
        ] as [Tab, string][]).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setTab(v)}
            className={cn('shrink-0 whitespace-nowrap px-3 py-1.5 text-sm rounded', tab === v ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'lines' && (
        <ul className="divide-y rounded-lg border bg-white">
          {delivery.items.map(i => {
            const lineSignals = delivery.signals.filter(s => s.delivery_item_id === i.id && s.status === 'open').length
            const planIds = new Set(i.plan.map(p => p.id))
            const w = whereabouts(i, delivery.ship_lines.filter(l => planIds.has(l.plan_id)))
            return (
              <li key={i.id} className="space-y-3 p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <ProductThumb src={i.image} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/catalog/${i.product_id}`} className="font-medium hover:underline">{i.product_name}</Link>
                    <div className="text-xs text-muted-foreground">
                      {[
                        i.product_sku,
                        LABEL_KIND_LABEL[i.label_kind].toLowerCase(),
                        i.supplier_name,
                        i.doc_number ? `Ф-ра ${i.doc_number}` : null,
                        `${formatQtyWithPacks(i.quantity, i.pack_size)} × ${formatMoney(i.unit_cost)}`,
                      ].filter(Boolean).join(' · ')}
                      {lineSignals > 0 && <span className="ml-1 text-red-700">· {lineSignals} проблем</span>}
                    </div>
                  </div>
                  {open && <PlanDialog deliveryId={delivery.id} item={i} stores={shopStores} warehouseName={warehouseName} />}
                </div>
                <WhereIsIt
                  w={w}
                  storeName={id => storeName.get(id) ?? '?'}
                  warehouseName={warehouseName}
                  labelHref={`/deliveries/labels?delivery=${delivery.id}`}
                />
              </li>
            )
          })}
        </ul>
      )}

      {tab === 'log' && (
        <div className="rounded-lg border bg-white">
          {delivery.events.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Няма записи.</p>
          ) : (
            <ul className="divide-y">
              {delivery.events.map(e => (
                <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
                  <span className="w-40 shrink-0 text-slate-500 tabular-nums">{sofiaDateTime(e.created_at)}</span>
                  <span className="w-40 shrink-0 font-medium">{e.user_name ?? '—'}</span>
                  <span className="flex-1 min-w-[200px]">
                    {eventText({
                      type: e.type,
                      qty: e.qty,
                      details: e.details,
                      product_name: e.delivery_item_id ? itemName.get(e.delivery_item_id) : null,
                      store_name: e.store_id ? storeName.get(e.store_id) : null,
                      store_names: storeName,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">Дневникът не се трие и не се редактира. Поправката е нов запис.</p>
        </div>
      )}

      {tab === 'problems' && (
        <div className="rounded-lg border bg-white">
          {delivery.signals.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Няма отбелязани проблеми.</p>
          ) : (
            <ul className="divide-y">
              {delivery.signals.map(s => (
                <li key={s.id} className="px-4 py-3 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs border',
                      s.status === 'open' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200')}>
                      {s.status === 'open' ? 'Отворен' : 'Решен'}
                    </span>
                    <span className="font-medium">{SIGNAL_REASON_LABEL[s.reason as SignalReason] ?? s.reason}</span>
                    <span className="text-slate-600">· {SIGNAL_STEP_LABEL[s.step] ?? s.step}</span>
                    {s.delivery_item_id && <span>· {itemName.get(s.delivery_item_id)}</span>}
                    {s.status === 'open' && (
                      <span className="ml-auto">
                        <ResolveButton signalId={s.id} step={s.step}
                          title={`${SIGNAL_REASON_LABEL[s.reason as SignalReason] ?? s.reason}${s.delivery_item_id ? `, ${itemName.get(s.delivery_item_id) ?? ''}` : ''}`}
                          userName={userName} />
                      </span>
                    )}
                  </div>
                  {(s.qty_expected != null || s.qty_actual != null) && (
                    <div className="text-slate-600">Очаквани {s.qty_expected ?? '—'} бр., реално {s.qty_actual ?? '—'} бр.</div>
                  )}
                  {s.note && <div className="text-slate-600">„{s.note}“</div>}
                  <div className="text-xs text-slate-500">
                    {s.creator ?? '—'}, {sofiaDateTime(s.created_at)}
                    {s.status === 'resolved' && (
                      <> · решен от {s.resolver ?? '—'} ({SIGNAL_RESOLUTION_LABEL[s.resolution ?? ''] ?? s.resolution}){s.resolution_note ? `: ${s.resolution_note}` : ''}</>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">Доставката не става „Завършена“, докато има отворен проблем. Всички проблеми са и в „Проблеми“.</p>
        </div>
      )}

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} deliveryId={delivery.id} received={received} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}{hint && <span className="ml-1 text-xs font-normal text-slate-500">{hint}</span>}</div>
    </div>
  )
}

function PlanDialog({ deliveryId, item, stores, warehouseName }: {
  deliveryId: string
  item: DetailItem
  stores: { id: string; name: string }[]
  warehouseName: string
}) {
  const router = useRouter()
  const initial = (): PlanText => Object.fromEntries(item.plan.map(p => [p.store_id, p.planned_qty ? String(p.planned_qty) : '']))
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<PlanText>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const minByStore = Object.fromEntries(item.plan.map(p => [p.store_id, p.ready_qty]))

  async function submit() {
    const nums = planNumbers(plan)
    const storeIds = new Set([...item.plan.map(p => p.store_id), ...Object.keys(nums).filter(k => nums[k] > 0)])
    const rows = [...storeIds].map(store_id => ({ store_id, planned_qty: nums[store_id] ?? 0 }))
    if (rows.length === 0) return setError('Няма промяна')
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/items/${item.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Планът не се промени')
      setOpen(false)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => { setPlan(initial()); setError(''); setOpen(true) }}>План</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Разпределение: {item.product_name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Общо {item.quantity} бр. Не може под готовите за обекта; нов обект се добавя само от неразпределения остатък.
          </p>
          <PlanEditor quantity={item.quantity} stores={stores} warehouseName={warehouseName} plan={plan} onChange={setPlan} minByStore={minByStore} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Отказ</Button>
            <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Запази плана</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function CancelDialog({ open, onOpenChange, deliveryId, received }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  deliveryId: string
  received: number
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (reason.trim().length < 3) return setError('Напишете причина')
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/deliveries/${deliveryId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Доставката не се отказа')
      onOpenChange(false)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Отказ от доставката</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {received > 0
            ? `Получените ${received} бр. излизат от Офис. Може само ако нищо от доставката не е изпратено и всичко получено още е в Офис.`
            : 'Нищо не е получено, наличностите не се променят.'}
        </p>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Причина" aria-label="Причина за отказа" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Назад</Button>
          <Button variant="destructive" onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Откажи доставката</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
