import { describe, expect, it } from 'vitest'
import { overPlannedLine, planText, planTotals } from './plan'

describe('order plan helpers', () => {
  it('planText keeps only stores with units, as text', () => {
    expect(planText({ a: 3, b: 0 })).toEqual({ a: '3' })
    expect(planText(null)).toEqual({})
  })

  it('overPlannedLine names the first line whose stores get more than is ordered', () => {
    expect(overPlannedLine([
      { name: 'Чай', quantity: 10, plan: { a: 4, b: 6 } },
      { name: 'Крем', quantity: 5, plan: { a: 4, b: 2 } },
      { name: 'Сапун', quantity: 1, plan: { a: 9 } },
    ])).toBe('„Крем“: за магазините са 6 бр., а поръчвате 5. Намалете магазините или поръчайте повече.')
  })

  it('overPlannedLine leaves lines without a quantity to the quantity check', () => {
    expect(overPlannedLine([{ name: 'Чай', quantity: null, plan: { a: 4 } }])).toBeNull()
    expect(overPlannedLine([{ name: 'Чай', quantity: 4, plan: { a: 4 } }])).toBeNull()
  })

  it('planTotals counts units to stores and lines that have a split', () => {
    expect(planTotals([{ plan: { a: 2, b: 3 } }, { plan: {} }, { plan: { a: 1 } }])).toEqual({ units: 6, lines: 2 })
  })
})
