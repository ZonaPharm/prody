import { describe, expect, it } from 'vitest'
import {
  daysLeft, lowReason, lowStock, overOffice, paceText, reasonText, rowTab, sendPlan, shareOffice, targetQty, withoutSales,
  type LowInput,
} from './low-stock'

const stores = [
  { id: 'office', name: 'Офис', is_warehouse: true },
  { id: 'botev', name: 'Ботев', is_warehouse: false },
  { id: 'varna', name: 'Варна', is_warehouse: false },
  { id: 'zaimov', name: 'Заимов', is_warehouse: false },
]
const cream = { id: 'cream', name: 'Крем', sku: 'K1', min_quantity: 5 }
const tea = { id: 'tea', name: 'Чай', sku: null, min_quantity: null }
const q = (store_id: string, product_id: string, qty: number) => ({ store_id, product_id, qty })

function input(p: Partial<LowInput>): LowInput {
  return { stores, products: [cream, tea], stock: [], sold: [], onTrip: [], requested: [], ...p }
}

describe('rules', () => {
  it('days left at the pace of 30 days', () => {
    expect(daysLeft(10, 30)).toBe(10)
    expect(daysLeft(0, 30)).toBe(0)
    expect(daysLeft(5, 0)).toBeNull()
  })

  it('target: twice the minimum, or four weeks of sales if more', () => {
    expect(targetQty(5, 0)).toBe(10)
    expect(targetQty(5, 30)).toBe(28)
    expect(targetQty(0, 0)).toBe(1)
  })

  it('low only when it also sells there (Владимир: минимум + продажби)', () => {
    expect(lowReason(3, 5, 0, 'selling')).toBeNull()
    expect(lowReason(3, 5, 0, 'min')).toBe('under_min')
    expect(lowReason(0, 5, 2, 'selling')).toBe('out')
    expect(lowReason(5, 5, 2, 'selling')).toBe('under_min')
    // 10 in stock, 30 sold a month: 10 days left, under two weeks.
    expect(lowReason(10, 5, 30, 'selling')).toBe('runs_out')
    expect(lowReason(20, 5, 30, 'selling')).toBeNull()
  })
})

describe('lowStock', () => {
  it('only stores, never Офис; products the store neither carries nor sells are left out', () => {
    const r = lowStock(input({
      stock: [q('office', 'cream', 2), q('botev', 'cream', 1)],
      sold: [q('botev', 'cream', 3), q('office', 'cream', 9)],
    }))
    expect(r.rows.map(x => [x.store_id, x.product_id])).toEqual([['botev', 'cream']])
  })

  it('sums batches, uses default minimum 5 and skips inactive products', () => {
    const r = lowStock(input({
      products: [tea],
      stock: [q('botev', 'tea', 2), q('botev', 'tea', 2), q('botev', 'cream', 0)],
      sold: [q('botev', 'tea', 1), q('botev', 'cream', 4)],
    }))
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ product_id: 'tea', qty: 4, min: 5, reason: 'under_min', target: 10, need: 6 })
  })

  it('a store that sold it but has no batch any more counts as out of stock', () => {
    const r = lowStock(input({ sold: [q('varna', 'cream', 6)] }))
    expect(r.rows[0]).toMatchObject({ store_id: 'varna', qty: 0, reason: 'out' })
  })

  it('what is on a trip or asked for in Заявки lowers the need; fully covered rows go to "Вече идва"', () => {
    const r = lowStock(input({
      stock: [q('botev', 'cream', 2), q('varna', 'cream', 2), q('office', 'cream', 20)],
      sold: [q('botev', 'cream', 3), q('varna', 'cream', 3)],
      onTrip: [q('botev', 'cream', 8)],
      requested: [q('varna', 'cream', 3)],
    }))
    const botev = r.rows.find(x => x.store_id === 'botev')!
    const varna = r.rows.find(x => x.store_id === 'varna')!
    expect([botev.need, botev.suggest, rowTab(botev)]).toEqual([0, 0, 'coming'])
    expect([varna.need, varna.suggest, rowTab(varna)]).toEqual([5, 5, 'send'])
    // 20 in Офис, 8 already packed for Ботев: 12 free.
    expect(r.officeFree.cream).toBe(12)
  })

  it('not enough in Офис: the empty store first, everybody above the minimum before anyone gets more', () => {
    const r = lowStock(input({
      stock: [q('office', 'cream', 7), q('botev', 'cream', 0), q('varna', 'cream', 4), q('zaimov', 'cream', 3)],
      sold: [q('botev', 'cream', 2), q('varna', 'cream', 2), q('zaimov', 'cream', 2)],
    }))
    const g = r.byProduct[0]
    // Ботев is empty; Заимов has 45 days left, Варна 60.
    expect(g.rows.map(x => [x.store_name, x.need])).toEqual([['Ботев', 10], ['Заимов', 7], ['Варна', 6]])
    // Pass 1: Ботев 6 (0 → 6), Заимов 1 of 3 (only 1 left). Varna gets nothing.
    expect(g.rows.map(x => x.suggest)).toEqual([6, 1, 0])
    expect(g.suggest).toBe(7)
    expect(g.short).toBe(16)
  })

  it('nothing in Офис: the row is for ordering', () => {
    const r = lowStock(input({ stock: [q('botev', 'cream', 1)], sold: [q('botev', 'cream', 2)] }))
    expect(rowTab(r.rows[0])).toBe('order')
    expect(r.byProduct[0].short).toBe(9)
  })

  it('products with something to send come first, then by urgency', () => {
    const r = lowStock(input({
      stock: [q('botev', 'cream', 0), q('botev', 'tea', 3), q('office', 'tea', 5)],
      sold: [q('botev', 'cream', 2), q('botev', 'tea', 2)],
    }))
    expect(r.byProduct.map(g => g.product_id)).toEqual(['tea', 'cream'])
    expect(r.byStore.map(g => [g.store_name, g.rows.map(x => x.product_id)])).toEqual([['Ботев', ['cream', 'tea']]])
  })

  it('mode "min" also lists what the store carries but does not sell', () => {
    const data = input({ stock: [q('botev', 'cream', 2)] })
    expect(lowStock(data).rows).toHaveLength(0)
    expect(lowStock(data, 'min').rows).toHaveLength(1)
  })
})

describe('free in Офис from the database', () => {
  it('uses office_free_stock when given (open deliveries hold part of Офис)', () => {
    const r = lowStock(input({
      stock: [q('office', 'cream', 20), q('botev', 'cream', 0)],
      sold: [q('botev', 'cream', 3)],
      officeFree: { cream: 4 },
    }))
    expect(r.officeFree).toEqual({ cream: 4 })
    expect(r.rows[0].suggest).toBe(4)
    expect(r.byProduct[0].office).toBe(20)
  })
})

describe('shareOffice', () => {
  it('never gives more than free or more than needed', () => {
    const rows = [
      { qty: 0, min: 5, on_trip: 0, requested: 0, need: 4 },
      { qty: 0, min: 5, on_trip: 0, requested: 0, need: 10 },
    ]
    expect(shareOffice(rows, 100)).toEqual([4, 10])
    expect(shareOffice(rows, 0)).toEqual([0, 0])
    expect(shareOffice(rows, 8)).toEqual([4, 4])
  })
})

describe('texts', () => {
  it('reason with and without the pace', () => {
    expect(reasonText({ reason: 'out', days_left: 0, min: 5 }, { sales: true })).toBe('Свършил')
    expect(reasonText({ reason: 'under_min', days_left: 3, min: 5 }, { sales: true })).toBe('Под минимума (5)')
    expect(reasonText({ reason: 'runs_out', days_left: 9, min: 5 }, { sales: true })).toBe('Свършва до ~9 дни')
    expect(reasonText({ reason: 'runs_out', days_left: 1, min: 5 }, { sales: true })).toBe('Свършва до ~1 ден')
    expect(reasonText({ reason: 'runs_out', days_left: 9, min: 5 }, { sales: false })).toBe('Свършва скоро')
  })

  it('pace per week', () => {
    expect(paceText(30)).toBe('~7 бр./седм.')
    expect(paceText(3)).toBe('~3 бр./30 дни')
    expect(paceText(0)).toBe('Не се продава')
  })

  it('Офис gets no sales numbers', () => {
    expect(withoutSales({ sold: 30, days_left: 3 })).toEqual({ sold: 0, days_left: null, fast: true })
    expect(withoutSales({ sold: 1, days_left: 90 })).toEqual({ sold: 0, days_left: null, fast: false })
  })
})

describe('sending', () => {
  it('one request per store, zeros dropped, repeats merged', () => {
    expect(sendPlan([
      { store_id: 'botev', product_id: 'cream', qty: 3 },
      { store_id: 'varna', product_id: 'cream', qty: 0 },
      { store_id: 'botev', product_id: 'tea', qty: 2 },
      { store_id: 'botev', product_id: 'cream', qty: 1 },
    ])).toEqual([{ store_id: 'botev', lines: [{ product_id: 'cream', qty: 4 }, { product_id: 'tea', qty: 2 }] }])
  })

  it('flags products picked over what is free in Офис', () => {
    expect(overOffice([
      { store_id: 'botev', product_id: 'cream', qty: 3 },
      { store_id: 'varna', product_id: 'cream', qty: 3 },
      { store_id: 'varna', product_id: 'tea', qty: 1 },
    ], { cream: 5, tea: 1 })).toEqual(['cream'])
  })
})
