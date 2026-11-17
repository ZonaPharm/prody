import { describe, expect, it } from 'vitest'
import { clip, dateRange, searchTerm, summariseSales, timestampRange, toolJson, type SaleRow } from './util'

describe('dateRange', () => {
  const today = '2026-11-13'
  it('defaults to the last N days up to today', () => {
    expect(dateRange(undefined, undefined, { defaultDays: 7, maxDays: 366, today })).toEqual({ from: '2026-11-07', to: '2026-11-13' })
  })
  it('keeps a given range', () => {
    expect(dateRange('2026-11-01', '2026-11-05', { defaultDays: 7, maxDays: 366, today })).toEqual({ from: '2026-11-01', to: '2026-11-05' })
  })
  it('refuses bad dates, reversed and too long ranges', () => {
    expect(dateRange('2026-02-30', undefined, { defaultDays: 7, maxDays: 366, today })).toHaveProperty('error')
    expect(dateRange('2026-11-10', '2026-11-01', { defaultDays: 7, maxDays: 366, today })).toHaveProperty('error')
    expect(dateRange('2024-01-01', '2026-11-13', { defaultDays: 7, maxDays: 366, today })).toHaveProperty('error')
  })
})

describe('timestampRange', () => {
  it('covers whole Sofia days', () => {
    expect(timestampRange({ from: '2026-11-01', to: '2026-11-01' })).toEqual({
      fromTs: '2026-10-31T21:00:00.000Z', toTs: '2026-11-02T00:00:00.000Z',
    })
  })
})

describe('text going to the model', () => {
  it('clips long text', () => {
    expect(clip('x'.repeat(500), 10)).toBe('xxxxxxxxxx…')
    expect(clip(null)).toBeNull()
  })
  it('makes a search term safe for a PostgREST or() filter', () => {
    expect(searchTerm('Витамин C (1000), 30% "табл"')).toBe('Витамин C 1000 30 табл')
  })
  it('cuts a huge tool result and says so', () => {
    const s = toolJson({ a: 'x'.repeat(100) }, 50)
    expect(s.length).toBeLessThan(150)
    expect(s).toContain('съкратен')
  })
})

describe('summariseSales', () => {
  const rows: SaleRow[] = [
    { quantity: 2, sale_price: '10.50', sale_date: '2026-11-02', store_id: 's1', sold_by: 'u1', product_id: 'p1', payment_method: 'cash' },
    { quantity: 1, sale_price: 5, sale_date: '2026-11-01', store_id: 's2', sold_by: 'u1', product_id: 'p2', payment_method: 'card' },
    { quantity: 3, sale_price: '0.10', sale_date: '2026-11-02', store_id: 's1', sold_by: 'u2', product_id: 'p1', payment_method: null },
  ]
  it('revenue is quantity × price, as in Отчети', () => {
    const s = summariseSales(rows, 'none')
    expect(s.revenue).toBe(26.3)
    expect(s.units).toBe(6)
    expect(s.lines).toBe(3)
    expect(s.groups).toEqual([])
  })
  it('groups by store, biggest first, with labels', () => {
    const s = summariseSales(rows, 'store', k => (k === 's1' ? 'Ботев' : 'Офис'))
    expect(s.groups.map(g => [g.label, g.revenue, g.units])).toEqual([['Ботев', 21.3, 5], ['Офис', 5, 1]])
  })
  it('groups by day in date order; no payment method counts as cash', () => {
    expect(summariseSales(rows, 'day').groups.map(g => g.key)).toEqual(['2026-11-01', '2026-11-02'])
    expect(summariseSales(rows, 'payment_method').groups.map(g => [g.key, g.revenue])).toEqual([['cash', 21.3], ['card', 5]])
  })
})
