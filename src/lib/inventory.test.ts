import { describe, expect, it } from 'vitest'
import { calculateFIFODeduction } from './inventory'

// The batches arrive already ordered oldest first (getFIFOBatches sorts by
// created_at), so these tests pass them in that order and check that the
// deduction follows it.
const batch = (id: string, quantity_remaining: number, unit_cost = 1) => ({ id, quantity_remaining, unit_cost })

describe('calculateFIFODeduction', () => {
  it('takes everything from the oldest batch when it holds enough', () => {
    const result = calculateFIFODeduction([batch('old', 5, 2), batch('new', 5, 3)], 3)

    expect(result.deductedFrom).toEqual([{ batchId: 'old', qty: 3, unitCost: 2 }])
    expect(result.remainingNeeded).toBe(0)
  })

  it('empties the oldest batch before touching the next one', () => {
    const result = calculateFIFODeduction([batch('old', 2, 2), batch('mid', 4, 3), batch('new', 9, 4)], 5)

    expect(result.deductedFrom).toEqual([
      { batchId: 'old', qty: 2, unitCost: 2 },
      { batchId: 'mid', qty: 3, unitCost: 3 },
    ])
    expect(result.remainingNeeded).toBe(0)
  })

  it('carries each batch its own unit cost, so cost of goods follows the units sold', () => {
    const result = calculateFIFODeduction([batch('a', 1, 10), batch('b', 1, 12.5)], 2)

    const cost = result.deductedFrom.reduce((sum, d) => sum + d.qty * d.unitCost, 0)
    expect(cost).toBe(22.5)
  })

  it('uses up an exact match without reaching for another batch', () => {
    const result = calculateFIFODeduction([batch('a', 4), batch('b', 4)], 4)

    expect(result.deductedFrom).toEqual([{ batchId: 'a', qty: 4, unitCost: 1 }])
    expect(result.remainingNeeded).toBe(0)
  })

  it('reports the shortfall instead of inventing stock when the store holds too little', () => {
    const result = calculateFIFODeduction([batch('a', 2), batch('b', 1)], 5)

    expect(result.deductedFrom).toEqual([
      { batchId: 'a', qty: 2, unitCost: 1 },
      { batchId: 'b', qty: 1, unitCost: 1 },
    ])
    expect(result.remainingNeeded).toBe(2)
  })

  it('reports the whole quantity as missing when there are no batches', () => {
    const result = calculateFIFODeduction([], 3)

    expect(result.deductedFrom).toEqual([])
    expect(result.remainingNeeded).toBe(3)
  })

  it('does not change the batches it was given', () => {
    const batches = [batch('a', 2), batch('b', 3)]
    const snapshot = structuredClone(batches)

    calculateFIFODeduction(batches, 4)

    expect(batches).toEqual(snapshot)
  })
})
