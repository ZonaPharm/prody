import { describe, it, expect } from 'vitest'
import { orderCategoriesByUse, countFirstLine, closedOrder } from './categories'

const cats = [
  { id: 'a', name: 'Арома' },
  { id: 'p', name: 'Панацея' },
  { id: 'v', name: 'Витамаг' },
  { id: 'z', name: 'Зонафарм' },
]

describe('orderCategoriesByUse', () => {
  it('puts the suppliers the store sells most first', () => {
    const productCat = new Map<string, string | null>([['x1', 'p'], ['x2', 'p'], ['x3', 'z'], ['x4', null]])
    const sold = ['x1', 'x2', 'x1', 'x3', 'x4']
    expect(orderCategoriesByUse(cats, productCat, sold).map(c => c.id)).toEqual(['p', 'z', 'a', 'v'])
  })
  it('without sales keeps them alphabetical (Bulgarian order)', () => {
    const shuffled = [cats[3], cats[1], cats[0], cats[2]]
    expect(orderCategoriesByUse(shuffled, {}, []).map(c => c.name)).toEqual(['Арома', 'Витамаг', 'Зонафарм', 'Панацея'])
  })
  it('equal sales go alphabetically', () => {
    const r = orderCategoriesByUse(cats, { s1: 'v', s2: 'a' }, ['s1', 's2'])
    expect(r.map(c => c.id)).toEqual(['a', 'v', 'z', 'p'])
  })
  it('ignores sales of products it does not know', () => {
    expect(orderCategoriesByUse(cats, {}, ['gone']).map(c => c.id)).toEqual(['a', 'v', 'z', 'p'])
  })
  it('does not change the list it was given', () => {
    const copy = [...cats]
    orderCategoriesByUse(cats, { x: 'z' }, ['x'])
    expect(cats).toEqual(copy)
  })
})

describe('countFirstLine', () => {
  it('counts the buttons until the first one that wrapped', () => {
    expect(countFirstLine([2, 2, 2, 2, 48, 48, 94])).toBe(4)
  })
  it('everything on one line', () => {
    expect(countFirstLine([2, 2, 2])).toBe(3)
  })
  it('tolerates a pixel of rounding', () => {
    expect(countFirstLine([2, 2.5, 3, 48])).toBe(3)
  })
  it('nothing drawn', () => {
    expect(countFirstLine([])).toBe(0)
  })
})

describe('closedOrder', () => {
  it('nothing picked: the order as given', () => {
    expect(closedOrder(cats, null)).toBe(cats)
  })
  it('the picked supplier comes first, the others keep their order', () => {
    expect(closedOrder(cats, 'z').map(c => c.id)).toEqual(['z', 'a', 'p', 'v'])
  })
  it('the first one picked or an unknown id: unchanged', () => {
    expect(closedOrder(cats, 'a')).toBe(cats)
    expect(closedOrder(cats, 'nope')).toBe(cats)
  })
})
