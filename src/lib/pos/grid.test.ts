import { describe, it, expect } from 'vitest'
import { visiblePart, cartCounts, TILL_PAGE } from './grid'

describe('visiblePart', () => {
  const list = Array.from({ length: 150 }, (_, i) => i)
  it('draws the first page and says how many are left', () => {
    const r = visiblePart(list, TILL_PAGE)
    expect(r.shown).toHaveLength(60)
    expect(r.shown[0]).toBe(0)
    expect(r.more).toBe(90)
  })
  it('draws everything once the limit passes the end', () => {
    const r = visiblePart(list, 200)
    expect(r.shown).toHaveLength(150)
    expect(r.more).toBe(0)
  })
  it('a short list is drawn whole', () => {
    expect(visiblePart([1, 2, 3], TILL_PAGE)).toEqual({ shown: [1, 2, 3], more: 0 })
  })
  it('a bad limit draws nothing rather than throwing', () => {
    expect(visiblePart(list, -5)).toEqual({ shown: [], more: 150 })
  })
})

describe('cartCounts', () => {
  it('counts pieces per product', () => {
    expect(cartCounts([
      { product: { id: 'a' }, qty: 2 },
      { product: { id: 'b' }, qty: 1 },
    ])).toEqual({ a: 2, b: 1 })
  })
  it('an empty cart has no marks', () => {
    expect(cartCounts([])).toEqual({})
  })
})
