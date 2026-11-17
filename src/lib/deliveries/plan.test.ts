import { describe, expect, it } from 'vitest'
import { equalSplit, overPlanned, planRows, planSummary, plannedTotal, unallocated } from './plan'

describe('plan math', () => {
  it('the rest of the line stays in Офис, never negative', () => {
    expect(plannedTotal({ a: 20, b: 10 })).toBe(30)
    expect(unallocated(100, { a: 20, b: 10 })).toBe(70)
    expect(unallocated(10, { a: 20 })).toBe(0)
    expect(overPlanned(10, { a: 20 })).toBe(10)
    expect(overPlanned(100, { a: 20 })).toBe(0)
  })

  it('"Равно по всички" gives each store the same whole number; the remainder stays in Офис', () => {
    expect(equalSplit(100, ['a', 'b', 'c'])).toEqual({ a: 33, b: 33, c: 33 })
    expect(unallocated(100, equalSplit(100, ['a', 'b', 'c']))).toBe(1)
    expect(equalSplit(2, ['a', 'b', 'c'])).toEqual({ a: 0, b: 0, c: 0 })
    expect(equalSplit(0, ['a'])).toEqual({})
  })

  it('sends only stores with more than zero', () => {
    expect(planRows({ a: 5, b: 0, c: 2.7 })).toEqual([{ store_id: 'a', planned_qty: 5 }, { store_id: 'c', planned_qty: 2 }])
  })

  it('summarises a collapsed line', () => {
    const stores = [{ id: 'a', name: 'Заимов' }, { id: 'b', name: 'Ботев' }]
    expect(planSummary(100, { a: 20, b: 10 }, stores)).toBe('Заимов 20, Ботев 10 · Офис 70')
    expect(planSummary(5, {}, stores)).toBe('Без разпределение · Офис 5')
  })
})
