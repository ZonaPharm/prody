/**
 * The words of the notifications along the Deliveries chain and of the "Задачи"
 * cards: when a trip leaves, who gets what. Pure functions, so they are tested
 * without a database (notify-text.test.ts).
 */

import { formatShipmentNumber, formatTripNumber } from './format'

const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота']

/** Whole days from `today` to `date` (both YYYY-MM-DD, calendar days). */
export function daysBetween(today: string, date: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  const b = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/** "9:30" from "09:30" or "09:30:00"; '' for none. */
export function shortTime(time: string | null | undefined): string {
  if (!time) return ''
  const m = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!m) return ''
  return `${Number(m[1])}:${m[2]}`
}

/**
 * When a trip is to leave, the way people say it: "днес, 9:30", "утре",
 * "четвъртък 13.11", "вчера" (late). Null date: "без ден".
 */
export function whenText(date: string | null | undefined, time: string | null | undefined, today: string): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'без ден'
  const diff = daysBetween(today, date)
  const dd = `${date.slice(8, 10)}.${date.slice(5, 7)}`
  const weekday = WEEKDAYS[new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay()]
  let day: string
  if (diff === 0) day = 'днес'
  else if (diff === 1) day = 'утре'
  else if (diff === -1) day = 'вчера'
  else if (diff > 1 && diff < 7) day = `${weekday} ${dd}`
  else day = `${weekday} ${dd}.${date.slice(0, 4)}`
  const t = shortTime(time)
  return t ? `${day}, ${t}` : day
}

/** True when the day has passed and the trip has still not left. */
export function isLate(date: string | null | undefined, today: string): boolean {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && daysBetween(today, date) < 0
}

/** "Ботев", "Ботев и Център", "Ботев, Център и Младост". */
export function listText(names: string[]): string {
  const n = names.filter(Boolean)
  if (n.length <= 1) return n[0] ?? ''
  return `${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}`
}

export function unitsText(units: number): string {
  return `${units} бр.`
}

export function boxesWord(n: number): string {
  return n === 1 ? '1 кашон' : `${n} кашона`
}

export type NotificationKind =
  | 'trip_assigned'
  | 'trip_unassigned'
  | 'trip_changed'
  | 'trip_cancelled'
  | 'shipment_coming'
  | 'shipment_sent'
  | 'shipment_removed'
  | 'shipment_issue'

export type NotificationText = { kind: NotificationKind; title: string; body: string | null }

export type TripInfo = {
  number: number
  planned_date: string | null
  planned_time: string | null
  /** Store names on the trip, in route order. */
  stores: string[]
}

/** To the driver chosen for a trip. */
export function tripAssignedText(trip: TripInfo, today: string): NotificationText {
  return {
    kind: 'trip_assigned',
    title: `Имаш курс ${formatTripNumber(trip.number)}: ${whenText(trip.planned_date, trip.planned_time, today)}`,
    body: `${trip.stores.length === 1 ? 'Магазин' : 'Магазини'}: ${listText(trip.stores) || '—'}. ` +
      'Кашоните се взимат от Офис; при тръгване подписваш с паролата си.',
  }
}

/** To a driver who no longer drives the trip. */
export function tripUnassignedText(trip: Pick<TripInfo, 'number'>): NotificationText {
  return {
    kind: 'trip_unassigned',
    title: `Курс ${formatTripNumber(trip.number)} вече не е за теб`,
    body: 'Друг шофьор ще го направи.',
  }
}

/** To the driver and the stores when the day or hour of a trip changes. */
export function tripMovedText(trip: TripInfo, today: string): NotificationText {
  return {
    kind: 'trip_changed',
    title: `Курс ${formatTripNumber(trip.number)} е преместен: ${whenText(trip.planned_date, trip.planned_time, today)}`,
    body: trip.stores.length ? `${trip.stores.length === 1 ? 'Магазин' : 'Магазини'}: ${listText(trip.stores)}.` : null,
  }
}

export function tripCancelledText(trip: Pick<TripInfo, 'number'>, reason: string | null): NotificationText {
  return {
    kind: 'trip_cancelled',
    title: `Курс ${formatTripNumber(trip.number)} е отказан`,
    body: [reason ? `Причина: ${reason}.` : '', 'Стоката остава в Офис за следващ курс.'].filter(Boolean).join(' '),
  }
}

export type ShipmentInfo = { number: number; units: number; products: number }

/** To the sellers of a store: goods are on a trip to them (made, not left yet). */
export function shipmentComingText(ship: ShipmentInfo, trip: TripInfo, today: string): NotificationText {
  const when = trip.planned_date ? `, тръгва ${whenText(trip.planned_date, trip.planned_time, today)}` : ''
  return {
    kind: 'shipment_coming',
    title: `Идва към вас ${formatShipmentNumber(ship.number)}: ${unitsText(ship.units)}${when}`,
    body: `${ship.products} ${ship.products === 1 ? 'продукт' : 'продукта'} с курс ${formatTripNumber(trip.number)}. ` +
      'Не правете заявка за тях: вижте ги в „Задачи“.',
  }
}

/** To the sellers of a store: the driver signed and left Офис. */
export function shipmentSentText(ship: ShipmentInfo & { boxes: number | null }, driver: string | null): NotificationText {
  const parts = [driver ? `Шофьор ${driver}` : '', ship.boxes ? boxesWord(ship.boxes) : ''].filter(Boolean)
  return {
    kind: 'shipment_sent',
    title: `${formatShipmentNumber(ship.number)} е на път към вас: ${unitsText(ship.units)}`,
    body: `${parts.length ? parts.join(', ') + '. ' : ''}Стоката вече се продава при вас. Когато пристигне, отметнете я в „Пратки“.`,
  }
}

/** To the sellers of a store taken off a trip before it left. */
export function shipmentRemovedText(ship: Pick<ShipmentInfo, 'number'>, tripNumber: number, reason: string | null): NotificationText {
  return {
    kind: 'shipment_removed',
    title: `${formatShipmentNumber(ship.number)} няма да дойде с курс ${formatTripNumber(tripNumber)}`,
    body: [reason ? `Причина: ${reason}.` : '', 'Стоката остава в Офис за следващ курс.'].filter(Boolean).join(' '),
  }
}

/** To the admins: a store accepted a shipment with differences. */
export function shipmentIssueText(ship: Pick<ShipmentInfo, 'number'>, store: string, signals: number): NotificationText {
  return {
    kind: 'shipment_issue',
    title: `${store} прие ${formatShipmentNumber(ship.number)} с разлики`,
    body: `${signals} ${signals === 1 ? 'ред не е наред' : 'реда не са наред'}. Решете ги в „Проблеми“.`,
  }
}
