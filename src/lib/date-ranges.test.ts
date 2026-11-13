import { describe, it, expect } from 'vitest'
import { quickRange, activeQuickRange, usableDate, dateFieldAction, sofiaDayStartIso, sofiaDayEndIso } from './date-ranges'

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

describe('usableDate', () => {
  it('takes a whole real date', () => {
    expect(usableDate('2026-11-13')).toBe(true)
    expect(usableDate('2028-02-29')).toBe(true)
  })
  it('turns away what the field reports while the year is being typed', () => {
    for (const v of ['0002-11-05', '0020-11-05', '0202-11-05', '0001-11-10', '52026-11-01', '']) {
      expect(usableDate(v)).toBe(false)
    }
  })
  it('turns away days that do not exist', () => {
    expect(usableDate('2026-02-30')).toBe(false)
    expect(usableDate('2027-02-29')).toBe(false)
    expect(usableDate('2026-13-01')).toBe(false)
  })
})

describe('dateFieldAction', () => {
  it('searches only for a new usable date', () => {
    expect(dateFieldAction('2026-11-05', '2026-11-13')).toBe('search')
    expect(dateFieldAction('2026-11-13', '2026-11-13')).toBe('nothing')
    expect(dateFieldAction('0202-11-05', '2026-11-13')).toBe('wait')
    expect(dateFieldAction('', '2026-11-13')).toBe('wait')
  })
})

describe('sofia day bounds', () => {
  it('winter: the day starts at 22:00 UTC the evening before', () => {
    expect(sofiaDayStartIso('2026-11-13')).toBe('2026-11-12T22:00:00.000Z')
    expect(sofiaDayEndIso('2026-11-13')).toBe('2026-11-13T21:59:59.999Z')
  })
  it('summer: the day starts at 21:00 UTC the evening before', () => {
    expect(sofiaDayStartIso('2026-07-01')).toBe('2026-06-30T21:00:00.000Z')
    expect(sofiaDayEndIso('2026-07-01')).toBe('2026-07-01T20:59:59.999Z')
  })
  it('the days the clocks change', () => {
    // 29 March 2026: 03:00 -> 04:00; the day is 23 hours long.
    expect(sofiaDayStartIso('2026-03-29')).toBe('2026-03-28T22:00:00.000Z')
    expect(sofiaDayEndIso('2026-03-29')).toBe('2026-03-29T20:59:59.999Z')
    // 25 October 2026: 04:00 -> 03:00; the day is 25 hours long.
    expect(sofiaDayStartIso('2026-10-25')).toBe('2026-10-24T21:00:00.000Z')
    expect(sofiaDayEndIso('2026-10-25')).toBe('2026-10-25T21:59:59.999Z')
  })
})
