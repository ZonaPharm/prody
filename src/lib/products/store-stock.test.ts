import { describe, expect, it } from 'vitest'
import { storeStockTone } from './store-stock'

describe('storeStockTone', () => {
  it('marks a store with nothing left as empty', () => {
    expect(storeStockTone(0, 2)).toBe('empty')
    expect(storeStockTone(0)).toBe('empty')
    expect(storeStockTone(-1, 0)).toBe('empty')
  })

  it('marks a store at or below the minimum as low', () => {
    expect(storeStockTone(1, 2)).toBe('low')
    expect(storeStockTone(2, 2)).toBe('low')
  })

  it('treats anything above the minimum, or no minimum, as ok', () => {
    expect(storeStockTone(3, 2)).toBe('ok')
    expect(storeStockTone(1)).toBe('ok')
    expect(storeStockTone(1, null)).toBe('ok')
    expect(storeStockTone(1, 0)).toBe('ok')
  })
})
