import { describe, expect, it } from 'vitest'
import { initialOrderDate } from './new-product'

describe('initialOrderDate', () => {
  it('a new product starts with today', () => {
    expect(initialOrderDate(undefined, true, '2026-11-18')).toBe('2026-11-18')
    expect(initialOrderDate(null, true, '2026-11-18')).toBe('2026-11-18')
  })

  it('an edited product keeps its own date, without the time', () => {
    expect(initialOrderDate('2026-03-05', false, '2026-11-18')).toBe('2026-03-05')
    expect(initialOrderDate('2026-03-05T00:00:00+00:00', false, '2026-11-18')).toBe('2026-03-05')
  })

  it('an edited product without a date stays without one', () => {
    expect(initialOrderDate(null, false, '2026-11-18')).toBe('')
    expect(initialOrderDate('', false, '2026-11-18')).toBe('')
  })
})
