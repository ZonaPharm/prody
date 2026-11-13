import { describe, it, expect } from 'vitest'
import { quickRange, activeQuickRange } from './date-ranges'

describe('quickRange', () => {
  it('today is the given day', () => {
    expect(quickRange('today', '2026-11-12')).toEqual({ from: '2026-11-12', to: '2026-11-12' })
  })
  it('week runs Monday to Sunday (Thursday 12 Nov 2026)', () => {
    expect(quickRange('week', '2026-11-12')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
  })
  it('on a Sunday the week is the one ending that day', () => {
    expect(quickRange('week', '2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
  })
  it('on a Monday the week starts that day', () => {
    expect(quickRange('week', '2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
  })
  it('a week across a month and year end', () => {
    expect(quickRange('week', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' })
  })
  it('month is the first to the last day', () => {
    expect(quickRange('month', '2026-11-12')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(quickRange('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('activeQuickRange', () => {
  it('names the matching button', () => {
    expect(activeQuickRange('2026-11-12', '2026-11-12', '2026-11-12')).toBe('today')
    expect(activeQuickRange('2026-11-09', '2026-11-15', '2026-11-12')).toBe('week')
    expect(activeQuickRange('2026-11-01', '2026-11-30', '2026-11-12')).toBe('month')
  })
  it('a hand-picked range lights none', () => {
    expect(activeQuickRange('2026-10-01', '2026-11-12', '2026-11-12')).toBeNull()
  })
})
