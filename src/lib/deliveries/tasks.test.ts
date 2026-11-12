import { describe, expect, it } from 'vitest'
import {
  actionCount,
  adminTasks,
  driverPoolTasks,
  driverTasks,
  incomingByProduct,
  incomingText,
  sortTasks,
  storeTasks,
  type AdminState,
  type DriverTrip,
  type StoreShipment,
} from './tasks'

const TODAY = '2026-11-12'

const trip = (over: Partial<DriverTrip> = {}): DriverTrip => ({
  id: 't1', number: 27, status: 'open', planned_date: '2026-11-13', planned_time: '09:00', departed_at: null, notes: null,
  shipments: [
    { store: 'Ботев', status: 'packed', boxes: 2, units: 10 },
    { store: 'Център', status: 'packing', boxes: null, units: 4 },
  ],
  ...over,
})

describe('driver', () => {
  it('an open trip: where, when, how far the packing is', () => {
    const [t] = driverTasks([trip()], TODAY, { admin: false })
    expect(t.title).toBe('Курс К-000027 до Ботев и Център')
    expect(t.when).toBe('утре, 9:00')
    expect(t.tone).toBe('do')
    expect(t.detail).toContain('готови 1 от 2')
    expect(t.items).toEqual(['Ботев · 2 кашона · 10 бр.', 'Център · 4 бр.'])
    expect(t.href).toBeUndefined() // a seller has no trip page
  })

  it('all packed: come and sign; an admin driver gets the trip page', () => {
    const [t] = driverTasks([trip({ shipments: [{ store: 'Ботев', status: 'packed', boxes: 1, units: 3 }] })], TODAY, { admin: true })
    expect(t.detail).toMatch(/^Кашоните са готови/)
    expect(t.href).toBe('/deliveries/trips/t1')
  })

  it('a past day is late; a removed store is not on the card; an empty trip has no card', () => {
    const [t] = driverTasks([trip({ planned_date: '2026-11-11', shipments: [
      { store: 'Ботев', status: 'packing', boxes: null, units: 1 },
      { store: 'Център', status: 'cancelled', boxes: null, units: 0 },
    ] })], TODAY, { admin: false })
    expect(t.tone).toBe('late')
    expect(t.when).toBe('вчера, 9:00: закъснява')
    expect(t.title).toBe('Курс К-000027 до Ботев')
    expect(driverTasks([trip({ shipments: [] })], TODAY, { admin: false })).toEqual([])
  })

  it('a departed trip lists the stores still to reach, and goes when all accepted', () => {
    const departed = trip({ status: 'departed', shipments: [
      { store: 'Ботев', status: 'received', boxes: 2, units: 10 },
      { store: 'Център', status: 'sent', boxes: 1, units: 4 },
    ] })
    const [t] = driverTasks([departed], TODAY, { admin: false })
    expect(t.title).toBe('Разнеси курс К-000027')
    expect(t.detail).toContain('Остават Център')
    expect(driverTasks([{ ...departed, shipments: departed.shipments.map(s => ({ ...s, status: 'received' })) }], TODAY, { admin: false })).toEqual([])
  })
})

describe('store', () => {
  const ship = (over: Partial<StoreShipment> = {}): StoreShipment => ({
    id: 's1', number: 35, status: 'packed', boxes: 2, trip_number: 27, planned_date: '2026-11-13', planned_time: null, driver: 'Ивайло',
    lines: [
      { product_id: 'p1', product_name: 'Крем', qty: 6, plan_id: 'pl1' },
      { product_id: 'p1', product_name: 'Крем', qty: 4, plan_id: 'pl2' },
      { product_id: 'p2', product_name: 'Чай', qty: 2, plan_id: 'pl3' },
    ],
    ...over,
  })

  it('a shipment on a trip is coming, with the day and the products merged', () => {
    const [t] = storeTasks([ship()], [], TODAY)
    expect(t.tone).toBe('coming')
    expect(t.title).toBe('П-000035: 12 бр. от 2 продукта')
    expect(t.detail).toContain('чака транспорт')
    expect(t.when).toBe('тръгва утре')
    expect(t.items).toEqual(['Крем · 10 бр.', 'Чай · 2 бр.'])
  })

  it('a sent shipment is a task to accept, with its page', () => {
    const [t] = storeTasks([ship({ status: 'sent' })], [], TODAY)
    expect(t.tone).toBe('do')
    expect(t.href).toBe('/my-shipments/s1')
    expect(t.detail).toMatch(/^Носи я Ивайло, 2 кашона\. /)
  })

  it('goods being prepared are one card; nothing prepared, no card', () => {
    const tasks = storeTasks([], [{ product_id: 'p3', product_name: 'Витамин', qty: 5 }, { product_id: 'p3', product_name: 'Витамин', qty: 2 }], TODAY)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('7 бр. от 1 продукт')
    expect(storeTasks([], [], TODAY)).toEqual([])
  })

  it('per product for "Заявки": on the way, on a trip, prepared', () => {
    const map = incomingByProduct(
      [ship({ status: 'sent', number: 34 }), ship()],
      [{ product_id: 'p1', product_name: 'Крем', qty: 3 }],
    )
    expect(map.p1).toEqual({ onWay: 10, onTrip: 10, prepared: 3, shipments: [34, 35] })
    expect(incomingText(map.p1)).toBe('Вече идва към вас: 10 бр. на път, 10 бр. в курс, 3 бр. се подготвят (П-000034, П-000035)')
    expect(incomingText(undefined)).toBeNull()
    expect(incomingText({ onWay: 0, onTrip: 0, prepared: 0, shipments: [] })).toBeNull()
  })
})

describe('Офис', () => {
  const state = (over: Partial<AdminState> = {}): AdminState => ({
    toReceive: [], labelRows: 0, labelUnits: 0, readyStores: [], trips: [], problems: 0, atStores: 0, ...over,
  })

  it('nothing waits: no cards', () => {
    expect(adminTasks(state(), TODAY)).toEqual([])
  })

  it('one card per waiting step, problems first after sorting', () => {
    const tasks = sortTasks(adminTasks(state({
      toReceive: [{ id: 'd1', number: 29, units: 20 }],
      labelRows: 2, labelUnits: 15,
      readyStores: [{ name: 'Ботев', units: 10 }],
      problems: 1,
      atStores: 2,
    }), TODAY))
    expect(tasks.map(t => t.key)).toEqual(['problems', 'receive', 'label', 'trip', 'stores'])
    expect(tasks[1].title).toBe('Получи доставка Д-000029')
    expect(tasks[1].href).toBe('/deliveries/d1/receive')
    expect(actionCount(tasks)).toBe(4) // "stores" only informs
  })

  it('Офис without Администратор: no receiving, problems or stores cards', () => {
    const tasks = sortTasks(adminTasks(state({
      toReceive: [{ id: 'd1', number: 29, units: 20 }],
      labelRows: 2, labelUnits: 15,
      readyStores: [{ name: 'Ботев', units: 10 }],
      problems: 1,
      atStores: 2,
    }), TODAY, { office: true }))
    expect(tasks.map(t => t.key)).toEqual(['label', 'trip'])
  })

  it('an open trip without driver asks for one; packing vs ready to leave', () => {
    const tasks = adminTasks(state({ trips: [
      { id: 't1', number: 27, status: 'open', planned_driver: null, planned_date: null, planned_time: null, shipments: [{ status: 'packing' }] },
      { id: 't2', number: 28, status: 'open', planned_driver: 'Ивайло', planned_date: '2026-11-10', planned_time: null, shipments: [{ status: 'packed', store: 'Ботев' }, { status: 'cancelled', store: 'Център' }] },
    ] }), TODAY)
    expect(tasks.map(t => t.key)).toEqual(['plan-t1', 'pack-t1', 'send-t2'])
    expect(tasks[0].title).toBe('Избери шофьор и ден за курс К-000027')
    expect(tasks[2].tone).toBe('late')
    expect(tasks[2].detail).toContain('Ивайло подписва')
    expect(tasks[2].label).toBe('Стъпка 6: Чака шофьора')
    expect(tasks[2].title).toBe('Курс К-000028 до Ботев чака шофьора')
  })

  it('every driver sees packed trips waiting for transport; their own, or one still packing, not', () => {
    const trips = [
      { id: 'a', number: 27, status: 'open' as const, planned_driver_id: 'ivo', planned_driver: 'Ивайло', planned_date: '2026-11-12', planned_time: '09:00', shipments: [{ status: 'packed', store: 'Ботев' }] },
      { id: 'b', number: 28, status: 'open' as const, planned_driver_id: null, planned_driver: null, planned_date: null, planned_time: null, shipments: [{ status: 'packed', store: 'Център' }, { status: 'cancelled', store: 'Младост' }] },
      { id: 'c', number: 29, status: 'open' as const, planned_driver_id: null, planned_driver: null, planned_date: null, planned_time: null, shipments: [{ status: 'packing', store: 'Ботев' }] },
      { id: 'd', number: 30, status: 'open' as const, planned_driver_id: 'ivo', planned_driver: 'Ивайло', planned_date: '2026-11-11', planned_time: null, shipments: [{ status: 'packed', store: 'Ботев' }] },
    ]
    const other = driverPoolTasks(trips, 'pesho', TODAY)
    expect(other.map(t => [t.key, t.tone])).toEqual([['pool-a', 'coming'], ['pool-b', 'do'], ['pool-d', 'late']])
    expect(other[0].title).toBe('Курс К-000027 до Ботев чака транспорт')
    expect(other[0].detail).toContain('Кара Ивайло. Ако го няма')
    expect(other[1].title).toBe('Курс К-000028 до Център чака транспорт')
    expect(driverPoolTasks(trips, 'ivo', TODAY).map(t => t.key)).toEqual(['pool-b'])
  })
})
