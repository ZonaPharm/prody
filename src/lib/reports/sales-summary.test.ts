import { describe, it, expect } from 'vitest'
import { summarizeSales, summarizeVoided, lineCost, previousPeriod, changePct, weekdayIndex, sofiaHour, weekdayOccurrences, type SaleRow } from './sales-summary'

let n = 0
const sale = (o: Partial<SaleRow>): SaleRow => ({
  id: 's' + (++n),
  sale_group_id: null,
  store_id: 'botev',
  store_name: 'Ботев',
  product_id: 'p1',
  product_name: 'Крем',
  quantity: 1,
  sale_price: '10.00',
  payment_method: 'cash',
  sale_date: '2026-11-10',
  cost_price: null,
  ...o,
})

describe('lineCost', () => {
  it('uses the batch prices of the units sold', () => {
    const s = sale({ quantity: 3 })
    expect(lineCost(s, [{ sale_id: s.id, quantity: -2, unit_cost: '4.00' }, { sale_id: s.id, quantity: -1, unit_cost: 5 }])).toBe(13)
  })
  it('prices units without a movement, or with batch price 0, at the catalogue cost', () => {
    const s = sale({ quantity: 3, cost_price: '6' })
    expect(lineCost(s, [{ sale_id: s.id, quantity: -1, unit_cost: 4 }])).toBe(4 + 12)
    expect(lineCost(s, [{ sale_id: s.id, quantity: -3, unit_cost: 0 }])).toBe(18)
    expect(lineCost(s, [])).toBe(18)
  })
  it('is unknown when a unit has no price anywhere', () => {
    const s = sale({ quantity: 2 })
    expect(lineCost(s, [])).toBeNull()
    expect(lineCost(s, [{ sale_id: s.id, quantity: -1, unit_cost: 4 }])).toBeNull()
  })
})

describe('summarizeSales', () => {
  it('counts receipts, not rows: three products paid together are one receipt', () => {
    const r = summarizeSales([
      sale({ sale_group_id: 'g1', sale_price: 10 }),
      sale({ sale_group_id: 'g1', sale_price: 20, product_id: 'p2' }),
      sale({ sale_group_id: 'g1', sale_price: 30, product_id: 'p3' }),
      sale({ sale_group_id: 'g2', sale_price: 40, quantity: 2 }),
    ], [])
    expect(r.totals.receipts).toBe(2)
    expect(r.totals.revenue).toBe(140)
    expect(r.totals.avgReceipt).toBe(70)
    expect(r.totals.units).toBe(5)
    expect(r.uniqueProducts).toBe(3)
  })

  it('an old row without a group is a receipt of its own', () => {
    const r = summarizeSales([sale({}), sale({})], [])
    expect(r.totals.receipts).toBe(2)
  })

  it('profit and margin cover only the lines with a known cost, and coverage says how much', () => {
    const a = sale({ sale_price: 10, quantity: 2 }) // revenue 20, cost 8
    const b = sale({ sale_price: 30, product_id: 'p2' }) // revenue 30, cost unknown
    const r = summarizeSales([a, b], [{ sale_id: a.id, quantity: -2, unit_cost: 4 }])
    expect(r.totals).toMatchObject({ revenue: 50, revenueWithCost: 20, cost: 8, profit: 12, marginPct: 60, costCoverage: 40 })
  })

  it('splits cash and card, per store too', () => {
    const r = summarizeSales([
      sale({ payment_method: 'cash', sale_price: 10 }),
      sale({ payment_method: 'card', sale_price: 25, store_id: 'zaimov', store_name: 'Заимов' }),
      sale({ payment_method: null, sale_price: 5 }),
    ], [])
    expect(r.payment).toEqual({ cash: 15, card: 25, other: 0 })
    expect(r.byStore.find(s => s.store_id === 'zaimov')!.payment).toEqual({ cash: 0, card: 25, other: 0 })
  })

  it('gives each store its own receipts, average and profit, biggest first', () => {
    const a = sale({ sale_group_id: 'g1', sale_price: 10, cost_price: 6 })
    const b = sale({ sale_group_id: 'g2', sale_price: 50, store_id: 'zaimov', store_name: 'Заимов', cost_price: 20 })
    const c = sale({ sale_group_id: 'g2', sale_price: 50, store_id: 'zaimov', store_name: 'Заимов', cost_price: 20, product_id: 'p2' })
    const r = summarizeSales([a, b, c], [])
    expect(r.byStore.map(s => s.store_name)).toEqual(['Заимов', 'Ботев'])
    expect(r.byStore[0]).toMatchObject({ revenue: 100, receipts: 1, avgReceipt: 100, profit: 60, marginPct: 60 })
    expect(r.byStore[1]).toMatchObject({ revenue: 10, receipts: 1, profit: 4, marginPct: 40 })
  })

  it('adds profit per day and lists the most profitable products', () => {
    const r = summarizeSales([
      sale({ sale_date: '2026-11-11', sale_price: 10, cost_price: 4, product_id: 'p1', product_name: 'Крем' }),
      sale({ sale_date: '2026-11-10', sale_price: 100, cost_price: 90, product_id: 'p2', product_name: 'Уред' }),
      sale({ sale_date: '2026-11-10', sale_price: 30, product_id: 'p3', product_name: 'Без цена' }),
    ], [])
    expect(r.byDay).toEqual([
      { sale_date: '2026-11-10', revenue: 130, profit: 10 },
      { sale_date: '2026-11-11', revenue: 10, profit: 6 },
    ])
    expect(r.topByProfit.map(p => p.name)).toEqual(['Уред', 'Крем'])
    expect(r.topByProfit[1]).toMatchObject({ profit: 6, marginPct: 60, units: 1 })
  })

  it('is all zeros with no sales', () => {
    const r = summarizeSales([], [])
    expect(r.totals).toMatchObject({ revenue: 0, receipts: 0, avgReceipt: 0, marginPct: null, costCoverage: null })
  })
})

describe('previousPeriod', () => {
  it('is the same number of days right before', () => {
    expect(previousPeriod('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' })
    expect(previousPeriod('2026-11-18', '2026-11-18')).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(previousPeriod('2026-03-01', '2026-03-07')).toEqual({ from: '2026-02-22', to: '2026-02-28' })
  })
})

describe('changePct', () => {
  it('is the percent change, or null with nothing before', () => {
    expect(changePct(120, 100)).toBe(20)
    expect(changePct(90, 120)).toBe(-25)
    expect(changePct(5, 0)).toBeNull()
  })
})

describe('sellers', () => {
  it('gives each seller their takings, receipts and average receipt', () => {
    const r = summarizeSales([
      sale({ sold_by: 'u1', seller_name: 'Мира', sale_group_id: 'g1', sale_price: 10 }),
      sale({ sold_by: 'u1', seller_name: 'Мира', sale_group_id: 'g1', sale_price: 20 }),
      sale({ sold_by: 'u2', seller_name: 'Деси', sale_group_id: 'g2', sale_price: 50 }),
      sale({ sold_by: 'u2', seller_name: 'Деси', sale_group_id: 'g3', sale_price: 10 }),
    ], [])
    expect(r.bySeller).toEqual([
      { sold_by: 'u2', name: 'Деси', revenue: 60, receipts: 2, avgReceipt: 30, units: 2 },
      { sold_by: 'u1', name: 'Мира', revenue: 30, receipts: 1, avgReceipt: 30, units: 2 },
    ])
  })
})

describe('when it sells', () => {
  it('knows the weekday of a date, Monday first', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0) // Monday
    expect(weekdayIndex('2026-11-22')).toBe(6) // Sunday
  })

  it('reads the hour on a Sofia clock, summer and winter', () => {
    expect(sofiaHour('2026-11-18T08:30:00Z')).toBe(10) // UTC+2
    expect(sofiaHour('2026-07-01T08:30:00Z')).toBe(11) // UTC+3
    expect(sofiaHour('2026-11-18T22:10:00Z')).toBe(0)
  })

  it('counts each weekday in a period', () => {
    // 1–30 November 2026: starts on a Sunday, so Sunday and Monday come 5 times.
    expect(weekdayOccurrences('2026-11-01', '2026-11-30')).toEqual([5, 4, 4, 4, 4, 4, 5])
  })

  it('averages takings per weekday over the times it occurred, and counts receipts per hour', () => {
    const r = summarizeSales([
      sale({ sale_date: '2026-11-16', sale_price: 100, created_at: '2026-11-16T08:05:00Z', sale_group_id: 'a' }),
      sale({ sale_date: '2026-11-23', sale_price: 50, created_at: '2026-11-23T08:40:00Z', sale_group_id: 'b' }),
      sale({ sale_date: '2026-11-18', sale_price: 30, created_at: '2026-11-18T15:00:00Z', sale_group_id: 'c' }),
    ], [], { from: '2026-11-16', to: '2026-11-29' })
    const monday = r.when.weekdays[0]
    expect(monday).toMatchObject({ label: 'Понеделник', revenue: 150, receipts: 2, occurrences: 2, avgRevenue: 75 })
    expect(r.when.weekdays[2]).toMatchObject({ revenue: 30, occurrences: 2, avgRevenue: 15 })
    expect(r.when.hours).toEqual([
      { hour: 10, revenue: 150, receipts: 2 },
      { hour: 17, revenue: 30, receipts: 1 },
    ])
  })
})

describe('summarizeVoided', () => {
  it('totals voided rows and splits them by who sold them', () => {
    const v = summarizeVoided([
      { quantity: 2, sale_price: '5', sold_by: 'u1', seller_name: 'Мира' },
      { quantity: 1, sale_price: 30, sold_by: 'u2', seller_name: 'Деси' },
      { quantity: 1, sale_price: 4, sold_by: 'u1', seller_name: 'Мира' },
    ])
    expect(v).toEqual({
      rows: 3, units: 4, value: 44,
      bySeller: [{ name: 'Деси', rows: 1, value: 30 }, { name: 'Мира', rows: 2, value: 14 }],
    })
  })
})
