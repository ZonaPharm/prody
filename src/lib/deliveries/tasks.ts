/**
 * "Задачи": what each person has to do now along the Deliveries chain, and what
 * is coming to them, as simple cards with one button. Computed from the state of
 * the trips, shipments and plans as they are (never stored), so a card cannot go
 * stale: it disappears when the step is done. Pure functions; tasks-data.ts reads.
 *
 *  - Driver (any account chosen as the driver of a trip): the trip, when, where.
 *  - Store (sellers): shipments to accept, shipments on the way or on a trip,
 *    goods being prepared for the store in Офис ("don't file a request for it").
 *  - Офис / admin: one card per step that waits (receive, label, trip, pack,
 *    driver, problems).
 */

import { formatDeliveryNumber, formatShipmentNumber, formatTripNumber } from './format'
import { boxesWord, isLate, listText, unitsText, whenText } from './notify-text'

export type TaskTone = 'do' | 'late' | 'problem' | 'coming'
export type TaskIcon = 'truck' | 'package' | 'tag' | 'inbox' | 'alert' | 'route' | 'user' | 'store'

export type Task = {
  key: string
  tone: TaskTone
  icon: TaskIcon
  /** Short step name above the title: "Курс", "Пратка", "Етикетиране". */
  label: string
  title: string
  /** When, in words: "утре, 9:00". */
  when?: string
  detail?: string
  /** A few lines under the card: stores of a trip, products of a shipment. */
  items?: string[]
  href?: string
  cta?: string
}

/** Cards that ask for something (not "coming"): the count in the menu. */
export function actionCount(tasks: Task[]): number {
  return tasks.filter(t => t.tone !== 'coming').length
}

const ORDER: Record<TaskTone, number> = { problem: 0, late: 1, do: 2, coming: 3 }

export function sortTasks(tasks: Task[]): Task[] {
  return tasks.map((t, i) => ({ t, i })).sort((a, b) => ORDER[a.t.tone] - ORDER[b.t.tone] || a.i - b.i).map(x => x.t)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export type DriverTripShipment = { store: string; status: string; boxes: number | null; units: number }

export type DriverTrip = {
  id: string
  number: number
  status: 'open' | 'departed'
  planned_date: string | null
  planned_time: string | null
  departed_at: string | null
  notes: string | null
  shipments: DriverTripShipment[]
}

function shipmentLine(s: DriverTripShipment): string {
  return [s.store, s.boxes ? boxesWord(s.boxes) : null, unitsText(s.units)].filter(Boolean).join(' · ')
}

/** The trips this person drives: the open ones to take, the departed ones to deliver. */
export function driverTasks(trips: DriverTrip[], today: string, opts: { admin: boolean }): Task[] {
  const out: Task[] = []
  for (const t of trips) {
    const live = t.shipments.filter(s => s.status !== 'cancelled')
    if (live.length === 0) continue
    const href = opts.admin ? `/deliveries/trips/${t.id}` : undefined
    if (t.status === 'open') {
      const packed = live.filter(s => s.status === 'packed').length
      const late = isLate(t.planned_date, today)
      out.push({
        key: `drive-${t.id}`,
        tone: late ? 'late' : 'do',
        icon: 'truck',
        label: 'Курс за теб',
        title: `Курс ${formatTripNumber(t.number)} до ${listText(live.map(s => s.store))}`,
        when: late ? `${whenText(t.planned_date, t.planned_time, today)}: закъснява` : whenText(t.planned_date, t.planned_time, today),
        detail: (packed === live.length
          ? 'Кашоните са готови в Офис. Вземи ги и подпиши с паролата си при тръгване.'
          : `В Офис опаковат: готови ${packed} от ${live.length} пратки. Подписваш при тръгване.`) + (t.notes ? ` Бележка: ${t.notes}` : ''),
        items: live.map(shipmentLine),
        href,
        cta: href ? 'Отвори курса' : undefined,
      })
    } else {
      const left = live.filter(s => s.status === 'sent')
      if (left.length === 0) continue
      out.push({
        key: `deliver-${t.id}`,
        tone: 'do',
        icon: 'route',
        label: 'На път',
        title: `Разнеси курс ${formatTripNumber(t.number)}`,
        detail: `Остават ${listText(left.map(s => s.store))}. Всеки магазин отметва пратката си, когато я получи.`,
        items: live.map(s => `${shipmentLine(s)}${s.status === 'sent' ? '' : ' · получена'}`),
        href,
        cta: href ? 'Отвори курса' : undefined,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type StoreShipmentLine = { product_id: string; product_name: string; qty: number; plan_id: string | null }

export type StoreShipment = {
  id: string
  number: number
  status: 'packing' | 'packed' | 'sent'
  boxes: number | null
  trip_number: number | null
  planned_date: string | null
  planned_time: string | null
  driver: string | null
  lines: StoreShipmentLine[]
}

/** A product planned for the store from an open delivery, not yet on a trip. */
export type StorePlanned = { product_id: string; product_name: string; qty: number }

function productLines(lines: { product_name: string; qty: number }[], max = 6): string[] {
  const sorted = [...lines].sort((a, b) => a.product_name.localeCompare(b.product_name, 'bg'))
  const shown = sorted.slice(0, max).map(l => `${l.product_name} · ${unitsText(l.qty)}`)
  if (sorted.length > max) shown.push(`и още ${plural(sorted.length - max, 'продукт', 'продукта')}`)
  return shown
}

function mergeByProduct<T extends { product_id: string; product_name: string; qty: number }>(rows: T[]) {
  const m = new Map<string, { product_id: string; product_name: string; qty: number }>()
  for (const r of rows) {
    const x = m.get(r.product_id) ?? { product_id: r.product_id, product_name: r.product_name, qty: 0 }
    x.qty += r.qty
    m.set(r.product_id, x)
  }
  return [...m.values()]
}

export function storeTasks(ships: StoreShipment[], planned: StorePlanned[], today: string): Task[] {
  const out: Task[] = []
  for (const s of [...ships].sort((a, b) => a.number - b.number)) {
    const units = s.lines.reduce((n, l) => n + l.qty, 0)
    const products = mergeByProduct(s.lines)
    if (s.status === 'sent') {
      out.push({
        key: `accept-${s.id}`,
        tone: 'do',
        icon: 'inbox',
        label: 'Пратка за приемане',
        title: `Приеми ${formatShipmentNumber(s.number)}: ${unitsText(units)}`,
        detail: [s.driver ? `Носи я ${s.driver}` : '', s.boxes ? boxesWord(s.boxes) : '']
          .filter(Boolean).join(', ') + (s.driver || s.boxes ? '. ' : '') +
          'Стоката вече се продава при вас. Когато пристигне, отметнете ред по ред.',
        items: productLines(products),
        href: `/my-shipments/${s.id}`,
        cta: 'Приеми пратката',
      })
    } else {
      out.push({
        key: `coming-${s.id}`,
        tone: 'coming',
        icon: 'truck',
        label: 'Идва към вас',
        title: `${formatShipmentNumber(s.number)}: ${unitsText(units)} от ${plural(products.length, 'продукт', 'продукта')}`,
        when: s.planned_date ? `тръгва ${whenText(s.planned_date, s.planned_time, today)}` : 'денят още не е определен',
        detail: `${s.trip_number ? `С курс ${formatTripNumber(s.trip_number)}. ` : ''}${s.status === 'packed' ? 'Опакована е в Офис и чака транспорт.' : 'Опакова се в Офис.'} Не правете заявка за тези продукти.`,
        items: productLines(products),
      })
    }
  }
  const prep = mergeByProduct(planned).filter(p => p.qty > 0)
  if (prep.length > 0) {
    const units = prep.reduce((n, p) => n + p.qty, 0)
    out.push({
      key: 'prepared',
      tone: 'coming',
      icon: 'package',
      label: 'Подготвя се за вас',
      title: `${unitsText(units)} от ${plural(prep.length, 'продукт', 'продукта')}`,
      detail: 'От доставка към Офис, разпределени за вашия магазин. Ще дойдат с някой от следващите курсове. Не правете заявка за тях.',
      items: productLines(prep),
    })
  }
  return out
}

/** Per product, what comes to the store and how far it is (for "Заявки"). */
export type Incoming = { onWay: number; onTrip: number; prepared: number; shipments: number[] }

export function incomingByProduct(ships: StoreShipment[], planned: StorePlanned[]): Record<string, Incoming> {
  const out: Record<string, Incoming> = {}
  const get = (id: string) => (out[id] ??= { onWay: 0, onTrip: 0, prepared: 0, shipments: [] })
  for (const s of ships) {
    for (const l of s.lines) {
      const x = get(l.product_id)
      if (s.status === 'sent') x.onWay += l.qty
      else x.onTrip += l.qty
      if (!x.shipments.includes(s.number)) x.shipments.push(s.number)
    }
  }
  for (const p of planned) if (p.qty > 0) get(p.product_id).prepared += p.qty
  return out
}

/** "Идва: 10 бр. (П-000035)", or null when nothing comes. */
export function incomingText(x: Incoming | undefined): string | null {
  if (!x) return null
  const total = x.onWay + x.onTrip + x.prepared
  if (total <= 0) return null
  const parts: string[] = []
  if (x.onWay) parts.push(`${unitsText(x.onWay)} на път`)
  if (x.onTrip) parts.push(`${unitsText(x.onTrip)} в курс`)
  if (x.prepared) parts.push(`${unitsText(x.prepared)} се подготвят`)
  const nums = x.shipments.map(formatShipmentNumber).join(', ')
  return `Вече идва към вас: ${parts.join(', ')}${nums ? ` (${nums})` : ''}`
}

// ---------------------------------------------------------------------------
// Офис / admin
// ---------------------------------------------------------------------------

export type AdminTrip = {
  id: string
  number: number
  status: 'open' | 'departed'
  planned_driver_id?: string | null
  planned_driver: string | null
  planned_date: string | null
  planned_time: string | null
  /** store: the store's name (for "чака шофьора до …"). */
  shipments: { status: string; store?: string }[]
}

export type AdminState = {
  toReceive: { id: string; number: number | null; units: number }[]
  labelRows: number
  labelUnits: number
  /** Stores with stock ready and on no trip yet. */
  readyStores: { name: string; units: number }[]
  trips: AdminTrip[]
  problems: number
  atStores: number
}

/** Steps only an admin does (Владимир, 2026-11-12): receiving and distributing, problems, the stores' overview. */
const ADMIN_ONLY_TASKS = new Set(['problems', 'receive', 'stores'])

/** office: Офис without Администратор gets the labelling, trip and packing steps only. */
export function adminTasks(s: AdminState, today: string, opts: { office?: boolean } = {}): Task[] {
  const out = adminAllTasks(s, today)
  return opts.office ? out.filter(t => !ADMIN_ONLY_TASKS.has(t.key)) : out
}

function adminAllTasks(s: AdminState, today: string): Task[] {
  const out: Task[] = []
  if (s.problems > 0) {
    out.push({
      key: 'problems', tone: 'problem', icon: 'alert', label: 'Проблеми',
      title: `${plural(s.problems, 'проблем чака', 'проблема чакат')} решение`,
      detail: 'Нещо не е наред при получаване, етикетиране, опаковане или в магазин.',
      href: '/deliveries/problems', cta: 'Към проблемите',
    })
  }
  if (s.toReceive.length > 0) {
    const units = s.toReceive.reduce((n, d) => n + d.units, 0)
    out.push({
      key: 'receive', tone: 'do', icon: 'inbox', label: 'Стъпка 2: Получаване в Офис',
      title: s.toReceive.length === 1
        ? `Получи доставка ${formatDeliveryNumber(s.toReceive[0].number)}`
        : `Получи ${s.toReceive.length} доставки`,
      detail: `Чакат ${unitsText(units)}. Отметни ред по ред какво е пристигнало.`,
      href: s.toReceive.length === 1 ? `/deliveries/${s.toReceive[0].id}/receive` : '/deliveries/work',
      cta: 'Получи',
    })
  }
  if (s.labelRows > 0) {
    out.push({
      key: 'label', tone: 'do', icon: 'tag', label: 'Стъпка 3: Етикетиране',
      title: `Етикетирай ${unitsText(s.labelUnits)}`,
      detail: `${plural(s.labelRows, 'ред', 'реда')} в Офис чакат етикет. Печатът е по избор; важни са „С етикет“ и подписът.`,
      href: '/deliveries/labels', cta: 'Етикетиране',
    })
  }
  if (s.readyStores.length > 0) {
    out.push({
      key: 'trip', tone: 'do', icon: 'truck', label: 'Стъпка 4: Курс',
      title: `Направи курс до ${listText(s.readyStores.map(r => r.name))}`,
      detail: 'Стоката е с етикет и чака. Избери магазините, шофьора и деня.',
      items: s.readyStores.map(r => `${r.name} · ${unitsText(r.units)}`),
      href: '/deliveries/trips', cta: 'Нов курс',
    })
  }
  for (const t of s.trips.filter(x => x.status === 'open')) {
    const live = t.shipments.filter(x => x.status !== 'cancelled')
    if (live.length === 0) continue
    const packing = live.filter(x => x.status === 'packing').length
    const late = isLate(t.planned_date, today)
    const when = t.planned_date ? whenText(t.planned_date, t.planned_time, today) : undefined
    if (!t.planned_driver || !t.planned_date) {
      out.push({
        key: `plan-${t.id}`, tone: 'do', icon: 'user', label: 'Курс без шофьор или ден',
        title: `Избери ${!t.planned_driver && !t.planned_date ? 'шофьор и ден' : !t.planned_driver ? 'шофьор' : 'ден'} за курс ${formatTripNumber(t.number)}`,
        detail: 'Шофьорът получава известие с деня и магазините, а магазините знаят кога идва стоката.',
        href: `/deliveries/trips/${t.id}`, cta: 'Отвори курса',
      })
    }
    out.push(packing > 0
      ? {
          key: `pack-${t.id}`, tone: late ? 'late' : 'do', icon: 'package', label: 'Стъпка 5: Опаковане',
          title: `Опаковай ${plural(packing, 'пратка', 'пратки')} за курс ${formatTripNumber(t.number)}`,
          when: when ? (late ? `${when}: закъснява` : when) : undefined,
          detail: t.planned_driver ? `Шофьор ${t.planned_driver}.` : undefined,
          href: `/deliveries/trips/${t.id}`, cta: 'Опаковай',
        }
      : {
          key: `send-${t.id}`, tone: late ? 'late' : 'do', icon: 'truck', label: 'Стъпка 6: Чака шофьора',
          title: `Курс ${formatTripNumber(t.number)}${tripStores(live) ? ` до ${tripStores(live)}` : ''} чака шофьора`,
          when: when ? (late ? `${when}: закъснява` : when) : undefined,
          detail: t.planned_driver
            ? `Всичко е опаковано. ${t.planned_driver} подписва с паролата си и курсът тръгва. Ако го няма, може да подпише друг шофьор.`
            : 'Всичко е опаковано, но няма избран шофьор. Изберете шофьор или нека подпише който кара.',
          href: `/deliveries/trips/${t.id}`, cta: 'Отвори курса',
        })
  }
  if (s.atStores > 0) {
    out.push({
      key: 'stores', tone: 'coming', icon: 'store', label: 'Стъпка 7: В магазините',
      title: `${plural(s.atStores, 'пратка чака', 'пратки чакат')} магазин да я отметне`,
      detail: 'Магазините приемат от „Пратки“. Вижте коя от колко време чака.',
      href: '/deliveries/work', cta: 'За работа',
    })
  }
  return out
}

function tripStores(ships: { status: string; store?: string }[]): string {
  return listText(ships.filter(x => x.status !== 'cancelled').map(x => x.store ?? '').filter(Boolean))
}

/**
 * For everyone with the driver role (not only the one chosen): trips packed and
 * waiting for transport, so that if the chosen driver is away, another sees it
 * and can take it (Владимир, 2026-11-12). The person's own trips are on their
 * driverTasks card already, so they are left out here.
 */
export function driverPoolTasks(trips: AdminTrip[], userId: string, today: string): Task[] {
  const out: Task[] = []
  for (const t of trips) {
    if (t.status !== 'open' || t.planned_driver_id === userId) continue
    const live = t.shipments.filter(x => x.status !== 'cancelled')
    if (live.length === 0 || live.some(x => x.status !== 'packed')) continue
    const late = isLate(t.planned_date, today)
    const when = t.planned_date ? whenText(t.planned_date, t.planned_time, today) : undefined
    const stores = tripStores(live)
    out.push({
      key: `pool-${t.id}`,
      tone: !t.planned_driver ? 'do' : late ? 'late' : 'coming',
      icon: 'truck',
      label: 'Чака шофьора',
      title: `Курс ${formatTripNumber(t.number)}${stores ? ` до ${stores}` : ''} чака транспорт`,
      when: when ? (late ? `${when}: закъснява` : when) : undefined,
      detail: t.planned_driver
        ? `Кара ${t.planned_driver}. Ако го няма, можеш да го поемеш: в Офис подписваш с паролата си при тръгване.`
        : 'Няма избран шофьор. Ако можеш да го поемеш, ела в Офис и подпиши с паролата си при тръгване.',
    })
  }
  return out
}
