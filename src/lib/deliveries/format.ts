/**
 * How deliveries read on screen: numbers, statuses, the line status computed
 * from its counters, and one sentence per log entry. Pure functions only.
 */

export type DeliveryStatus = 'draft' | 'expected' | 'in_progress' | 'completed' | 'cancelled'

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  draft: 'Чернова',
  expected: 'Очаква се',
  in_progress: 'В работа',
  completed: 'Завършена',
  cancelled: 'Отказана',
}

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  expected: 'bg-amber-50 text-amber-800 border-amber-200',
  in_progress: 'bg-blue-50 text-blue-800 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
}

export function deliveryStatusLabel(status: string): string {
  return DELIVERY_STATUS_LABEL[status as DeliveryStatus] ?? status
}

function pad(n: number): string {
  return String(n).padStart(6, '0')
}

/** Д-000124, or "Чернова" while the draft has no number yet. */
export function formatDeliveryNumber(number: number | null | undefined): string {
  return number == null ? 'Чернова' : `Д-${pad(number)}`
}

export function formatShipmentNumber(number: number | null | undefined): string {
  return number == null ? '' : `П-${pad(number)}`
}

export function formatTripNumber(number: number | null | undefined): string {
  return number == null ? '' : `К-${pad(number)}`
}

/** 1234.5 → "1 234,50 €" (two decimals; unit costs with more are rounded only for display). */
export function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

/** "120 бр." or "120 бр. (10 кутии по 12)" when the line came in boxes. */
export function formatQtyWithPacks(qty: number, packSize: number | null | undefined): string {
  const pack = packSize && packSize > 1 ? packSize : 1
  if (pack === 1) return `${qty} бр.`
  const boxes = Math.floor(qty / pack)
  const rest = qty - boxes * pack
  const boxWord = boxes === 1 ? 'кутия' : 'кутии'
  return rest === 0
    ? `${qty} бр. (${boxes} ${boxWord} по ${pack})`
    : `${qty} бр. (${boxes} ${boxWord} по ${pack} + ${rest} бр.)`
}

export type LineCounters = {
  quantity: number
  received_qty: number
  plan: { planned_qty: number; ready_qty: number; shipped_qty: number }[]
}

export type LineStatus =
  | 'expected'
  | 'partially_received'
  | 'received'
  | 'waiting_label'
  | 'ready'
  | 'partially_shipped'
  | 'shipped'

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  expected: 'Очаква се',
  partially_received: 'Частично получен',
  received: 'Получен (остава в Офис)',
  waiting_label: 'Чака преопаковане',
  ready: 'Готов за изпращане',
  partially_shipped: 'Частично изпратен',
  shipped: 'Изпратен',
}

/**
 * The status of one line follows its counters; nobody picks it by hand.
 * Очаква се → Частично получен → Чака преопаковане → Готов за изпращане →
 * Частично изпратен → Изпратен. A line with no plan stays in Офис once received.
 */
export function lineStatus(line: LineCounters): LineStatus {
  if (line.received_qty <= 0) return 'expected'
  if (line.received_qty < line.quantity) return 'partially_received'
  const planned = line.plan.reduce((s, p) => s + p.planned_qty, 0)
  const ready = line.plan.reduce((s, p) => s + p.ready_qty, 0)
  const shipped = line.plan.reduce((s, p) => s + p.shipped_qty, 0)
  if (planned <= 0) return 'received'
  if (shipped >= planned) return 'shipped'
  if (shipped > 0) return 'partially_shipped'
  if (ready >= planned) return 'ready'
  return 'waiting_label'
}

export type SignalReason = 'short' | 'partial' | 'damaged' | 'wrong_product' | 'wrong_label' | 'missing' | 'other'

export const SIGNAL_REASON_LABEL: Record<SignalReason, string> = {
  short: 'По-малко',
  partial: 'Частично',
  damaged: 'Повредено',
  wrong_product: 'Грешен продукт',
  wrong_label: 'Грешен етикет',
  missing: 'Липсва изцяло',
  other: 'Друго',
}

export const SIGNAL_STEP_LABEL: Record<string, string> = {
  receive: 'Получаване',
  label: 'Етикетиране',
  pack: 'Опаковане',
  store_receive: 'Получаване в обекта',
}

export const SIGNAL_RESOLUTION_LABEL: Record<string, string> = {
  corrected: 'Поправени бройки',
  returned_to_supplier: 'Връщане към доставчика',
  found: 'Намерено',
  other: 'Друго',
}

export type EventForText = {
  type: string
  qty: number | null
  details: Record<string, unknown> | null
  product_name?: string | null
  store_name?: string | null
}

function signalReasonText(reason: unknown): string {
  return SIGNAL_REASON_LABEL[reason as SignalReason] ?? String(reason ?? '')
}

/** One line of the delivery log, without who and when (shown beside it). */
export function eventText(e: EventForText): string {
  const product = e.product_name ? `„${e.product_name}“` : ''
  const store = e.store_name ?? ''
  const qty = e.qty ?? 0
  const d = e.details ?? {}
  switch (e.type) {
    case 'created':
      return 'Създадена чернова'
    case 'saved': {
      const items = typeof d.items === 'number' ? `, ${d.items} ${d.items === 1 ? 'ред' : 'реда'}` : ''
      return `Записана като ${formatDeliveryNumber(typeof d.number === 'number' ? d.number : null)}${items}`
    }
    case 'received':
      return `Получени ${qty} бр. ${product} в ${store || 'Офис'}`.trim()
    case 'plan_changed':
      return `Променено разпределение на ${product}`.trim()
    case 'ready':
      return `${d.auto ? 'Готови без етикет' : 'Готови'} ${qty} бр. ${product}${store ? ` за ${store}` : ''}`
    case 'trip_created':
      return 'Създаден курс'
    case 'packed':
      return 'Опакована пратка'
    case 'sent':
      return `Изпратена пратка${store ? ` към ${store}` : ''}`
    case 'store_received':
      return `Пратката е приета${store ? ` в ${store}` : ''}`
    case 'signal_raised': {
      const step = SIGNAL_STEP_LABEL[String(d.step)] ?? ''
      const counts = d.qty_expected != null || d.qty_actual != null
        ? ` (очаквани ${d.qty_expected ?? '—'}, реално ${d.qty_actual ?? '—'})`
        : ''
      return `Не е наред${step ? ` при ${step.toLowerCase()}` : ''}: ${signalReasonText(d.reason)} ${product}${counts}`.replace(/\s+/g, ' ').trim()
    }
    case 'signal_resolved':
      return 'Решен сигнал'
    case 'cancelled':
      return `Отказана${typeof d.reason === 'string' && d.reason ? `: ${d.reason}` : ''}`
    case 'completed':
      return 'Завършена'
    default:
      return e.type
  }
}
