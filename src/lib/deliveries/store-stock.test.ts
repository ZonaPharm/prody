import { describe, expect, it } from 'vitest'
import { MAX_STOCK_IDS, currentStockOf, parseProductIds, sumStockByStore } from './store-stock'

const P1 = '44444444-4444-4444-8444-444444444444'
const P2 = '44444444-4444-4444-8444-444444444445'
const S1 = '55555555-5555-4555-8555-555555555555'
const S2 = '55555555-5555-4555-8555-555555555556'
const OFFICE = '66666666-6666-4666-8666-666666666666'

describe('parseProductIds', () => {
  it('keeps uuids only, each once, lower case', () => {
    expect(parseProductIds(`${P1}, ${P1.toUpperCase()},x,,${P2}`)).toEqual([P1, P2])
  })
  it('is empty for nothing', () => {
    expect(parseProductIds(null)).toEqual([])
    expect(parseProductIds('')).toEqual([])
  })
  it(`stops at ${MAX_STOCK_IDS}`, () => {
    const ids = Array.from({ length: MAX_STOCK_IDS + 5 }, (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`)
    expect(parseProductIds(ids.join(','))).toHaveLength(MAX_STOCK_IDS)
  })
})

describe('sumStockByStore', () => {
  it('adds up the batches of a product in a store', () => {
    const map = sumStockByStore([P1], [
      { product_id: P1, store_id: S1, quantity_remaining: 3 },
      { product_id: P1, store_id: S1, quantity_remaining: '2' },
      { product_id: P1, store_id: S2, quantity_remaining: 1 },
    ])
    expect(map).toEqual({ [P1]: { [S1]: 5, [S2]: 1 } })
  })
  it('lists an asked product with no stock as empty, and skips empty batches', () => {
    const map = sumStockByStore([P1, P2], [{ product_id: P1, store_id: S1, quantity_remaining: 0 }])
    expect(map).toEqual({ [P1]: {}, [P2]: {} })
  })
})

describe('currentStockOf', () => {
  const stock = { [P1]: { [S1]: 4, [OFFICE]: 10 } }
  it('gives the stores, Офис and the minimum', () => {
    expect(currentStockOf(P1, stock, { [P1]: 5 }, OFFICE)).toEqual({ byStore: { [S1]: 4, [OFFICE]: 10 }, office: 10, min: 5 })
  })
  it('is undefined while the product is not loaded', () => {
    expect(currentStockOf(P2, stock, {}, OFFICE)).toBeUndefined()
  })
  it('has Офис 0 without a warehouse', () => {
    expect(currentStockOf(P1, stock, {}, null)?.office).toBe(0)
  })
})
