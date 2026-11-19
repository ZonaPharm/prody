import { describe, it, expect } from 'vitest'
import { stockValue, deadStock, writeOffs, unitCost, type BatchRow, type ProductRow, type StoreRow } from './stock-money'

const stores: StoreRow[] = [
  { id: 'office', name: 'Офис', is_warehouse: true },
  { id: 'botev', name: 'Ботев', is_warehouse: false },
  { id: 'zaimov', name: 'Заимов', is_warehouse: false },
]

const products: ProductRow[] = [
  { id: 'p1', name: 'Крем', price: '20.00', cost_price: '8.00' },
  { id: 'p2', name: 'Сапун', price: 5, cost_price: null },
  { id: 'p3', name: 'Без цени', price: null, cost_price: null },
]

const batch = (product_id: string, store_id: string, quantity_remaining: number, unit_cost: number | string | null, created_at = '2026-08-01T10:00:00Z'): BatchRow =>
  ({ product_id, store_id, quantity_remaining, unit_cost, created_at })

describe('unitCost', () => {
  it('uses the batch price when it is above zero', () => {
    expect(unitCost('7.50', products[0])).toBe(7.5)
  })
  it('falls back to the catalogue cost when the batch has 0 or nothing', () => {
    expect(unitCost(0, products[0])).toBe(8)
    expect(unitCost(null, products[0])).toBe(8)
  })
  it('is unknown when neither is there', () => {
    expect(unitCost(0, products[1])).toBeNull()
    expect(unitCost(null, undefined)).toBeNull()
  })
})

describe('stockValue', () => {
  it('sums units, purchase value and selling value per place', () => {
    const v = stockValue([
      batch('p1', 'office', 10, '7.00'),
      batch('p1', 'botev', 2, 0), // correction batch: catalogue cost 8
      batch('p2', 'botev', 4, '2.50'),
      batch('p3', 'zaimov', 3, null), // nothing known
    ], products, stores)

    const office = v.stores.find(s => s.store_id === 'office')!
    expect(office).toMatchObject({ units: 10, products: 1, cost: 70, retail: 200, unitsWithoutCost: 0 })

    const botev = v.stores.find(s => s.store_id === 'botev')!
    expect(botev).toMatchObject({ units: 6, products: 2, cost: 16 + 10, retail: 40 + 20 })

    const zaimov = v.stores.find(s => s.store_id === 'zaimov')!
    expect(zaimov).toMatchObject({ units: 3, cost: 0, retail: 0, unitsWithoutCost: 3, unitsWithoutPrice: 3 })

    expect(v.total).toMatchObject({ units: 19, products: 3, cost: 96, retail: 260, unitsWithoutCost: 3, unitsWithoutPrice: 3 })
  })

  it('lists Офис first and every active place even with no stock', () => {
    const v = stockValue([batch('p1', 'zaimov', 1, 5)], products, stores)
    expect(v.stores.map(s => s.store_id)).toEqual(['office', 'zaimov', 'botev'])
    expect(v.stores.find(s => s.store_id === 'botev')!.units).toBe(0)
  })

  it('skips empty batches and places that are not active', () => {
    const v = stockValue([batch('p1', 'botev', 0, 5), batch('p1', 'closed-store', 9, 5)], products, stores)
    expect(v.total.units).toBe(0)
  })
})

describe('deadStock', () => {
  const cutoff = '2026-09-19T00:00:00Z'

  it('counts old stock in a store with no sale in that store since the cutoff', () => {
    const d = deadStock([batch('p1', 'botev', 3, 8, '2026-07-01T00:00:00Z')], products, stores, [], cutoff)
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0]).toMatchObject({ product_name: 'Крем', store_name: 'Ботев', units: 3, cost: 24, retail: 60, since: '2026-07-01T00:00:00Z' })
    expect(d.total).toMatchObject({ units: 3, cost: 24, lines: 1 })
  })

  it('a sale in the same store means it is not dead; a sale elsewhere does not', () => {
    const b = [batch('p1', 'botev', 3, 8, '2026-07-01T00:00:00Z'), batch('p1', 'zaimov', 2, 8, '2026-07-01T00:00:00Z')]
    const d = deadStock(b, products, stores, [{ product_id: 'p1', store_id: 'botev' }], cutoff)
    expect(d.rows.map(r => r.store_id)).toEqual(['zaimov'])
  })

  it('Офис stock is dead only when it sold nowhere', () => {
    const b = [batch('p1', 'office', 5, 8, '2026-07-01T00:00:00Z')]
    expect(deadStock(b, products, stores, [{ product_id: 'p1', store_id: 'zaimov' }], cutoff).rows).toHaveLength(0)
    expect(deadStock(b, products, stores, [], cutoff).rows).toHaveLength(1)
  })

  it('does not count units that arrived after the cutoff', () => {
    const b = [
      batch('p1', 'botev', 2, 8, '2026-07-01T00:00:00Z'),
      batch('p1', 'botev', 10, 8, '2026-11-10T00:00:00Z'),
    ]
    const d = deadStock(b, products, stores, [], cutoff)
    expect(d.rows[0].units).toBe(2)
  })

  it('sorts by money held and keeps unknown cost as null, last', () => {
    const b = [
      batch('p3', 'botev', 50, null, '2026-07-01T00:00:00Z'),
      batch('p2', 'botev', 2, 1, '2026-07-01T00:00:00Z'),
      batch('p1', 'zaimov', 2, 8, '2026-07-01T00:00:00Z'),
    ]
    const d = deadStock(b, products, stores, [], cutoff)
    expect(d.rows.map(r => r.product_id)).toEqual(['p1', 'p2', 'p3'])
    expect(d.rows[2].cost).toBeNull()
    expect(d.total.unitsWithoutCost).toBe(50)
    expect(d.byStore[0]).toMatchObject({ store_id: 'zaimov', cost: 16 })
  })

  it('keeps the oldest arrival date of a product in a place', () => {
    const b = [
      batch('p1', 'botev', 1, 8, '2026-08-01T00:00:00Z'),
      batch('p1', 'botev', 1, 8, '2026-06-01T00:00:00Z'),
    ]
    expect(deadStock(b, products, stores, [], cutoff).rows[0]).toMatchObject({ units: 2, since: '2026-06-01T00:00:00Z' })
  })
})

describe('writeOffs', () => {
  const c = (id: string, difference: number, reason: string, movement_unit_cost: number | null = null, product_id = 'p1', store_id = 'botev') =>
    ({ id, product_id, store_id, difference, reason, movement_unit_cost, created_at: `2026-11-0${id}T10:00:00Z`, notes: null })

  it('values losses and surplus separately, by reason', () => {
    const w = writeOffs([
      c('1', -2, 'damaged', 7), // 14
      c('2', -1, 'expired'), // catalogue cost 8
      c('3', 3, 'inventory_count'), // surplus 24
      c('4', -4, 'inventory_count', null, 'p3'), // unknown cost
    ], products, stores)

    expect(w.losses.map(g => g.reason)).toEqual(['damaged', 'expired', 'inventory_count'])
    expect(w.losses[0]).toMatchObject({ label: 'Повредени', units: 2, value: 14, count: 1 })
    expect(w.losses[2]).toMatchObject({ units: 4, value: 0, unitsWithoutCost: 4 })
    expect(w.lossTotal).toEqual({ units: 7, value: 22, unitsWithoutCost: 4 })
    expect(w.surplus).toHaveLength(1)
    expect(w.surplusTotal).toEqual({ units: 3, value: 24, unitsWithoutCost: 0 })
    expect(w.byStore[0]).toMatchObject({ store_name: 'Ботев', lossUnits: 7, lossValue: 22, surplusUnits: 3, surplusValue: 24 })
  })

  it('a correction movement with price 0 (units added) falls back to the catalogue cost', () => {
    const w = writeOffs([c('1', 2, 'inventory_count', 0)], products, stores)
    expect(w.surplusTotal.value).toBe(16)
  })

  it('„Грешно въвеждане“ is listed but not in the totals or the stores', () => {
    const w = writeOffs([c('1', -2, 'damaged', 5), c('2', -3, 'wrong_entry', 5), c('3', 4, 'wrong_entry', 5)], products, stores)
    expect(w.losses.find(g => g.reason === 'wrong_entry')).toMatchObject({ units: 3, value: 15, counted: false })
    expect(w.losses.find(g => g.reason === 'damaged')!.counted).toBe(true)
    expect(w.lossTotal).toEqual({ units: 2, value: 10, unitsWithoutCost: 0 })
    expect(w.surplusTotal).toEqual({ units: 0, value: 0, unitsWithoutCost: 0 })
    expect(w.byStore).toEqual([{ store_id: 'botev', store_name: 'Ботев', lossUnits: 2, lossValue: 10, surplusUnits: 0, surplusValue: 0 }])
    expect(w.rows).toHaveLength(3)
  })

  it('lists the newest first, with the value of each row', () => {
    const w = writeOffs([c('1', -1, 'damaged', 5), c('2', -1, 'other')], products, stores)
    expect(w.rows.map(r => r.id)).toEqual(['2', '1'])
    expect(w.rows[1]).toMatchObject({ value: 5, label: 'Повредени', difference: -1 })
  })
})
