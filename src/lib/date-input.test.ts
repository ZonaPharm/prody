import { describe, it, expect } from 'vitest'
import { autoDots, formatDateBg, parseDateBg } from './date-input'

describe('formatDateBg', () => {
  it('shows дд.мм.гггг', () => {
    expect(formatDateBg('2026-11-08')).toBe('08.11.2026')
    expect(formatDateBg('2027-01-31')).toBe('31.01.2027')
  })
  it('shows nothing for an empty or broken value', () => {
    expect(formatDateBg('')).toBe('')
    expect(formatDateBg('8.11.2026')).toBe('')
  })
})

describe('parseDateBg', () => {
  it('day comes first: 08.11.2026 is 8 November', () => {
    expect(parseDateBg('08.11.2026')).toBe('2026-11-08')
    expect(parseDateBg('8.11.2026')).toBe('2026-11-08')
    expect(parseDateBg('8/11/2026')).toBe('2026-11-08')
    expect(parseDateBg('8-11-2026')).toBe('2026-11-08')
    expect(parseDateBg(' 08.11.2026 ')).toBe('2026-11-08')
    expect(parseDateBg('08112026')).toBe('2026-11-08')
  })
  it('a two-digit year only when asked for (Enter, leaving the field)', () => {
    expect(parseDateBg('08.11.26')).toBeNull()
    expect(parseDateBg('08.11.26', { shortYear: true })).toBe('2026-11-08')
    expect(parseDateBg('081126', { shortYear: true })).toBe('2026-11-08')
  })
  it('half-typed dates are not dates yet', () => {
    for (const t of ['', '08', '08.11', '08.11.', '08.11.2', '08.11.202', '0811']) {
      expect(parseDateBg(t)).toBeNull()
    }
    expect(parseDateBg('08.11.2', { shortYear: true })).toBeNull()
  })
  it('days that do not exist and years far off are turned away', () => {
    expect(parseDateBg('31.11.2026')).toBeNull()
    expect(parseDateBg('29.02.2027')).toBeNull()
    expect(parseDateBg('29.02.2028')).toBe('2028-02-29')
    expect(parseDateBg('08.13.2026')).toBeNull()
    expect(parseDateBg('08.11.1999')).toBeNull()
  })
  it('round trip with formatDateBg', () => {
    expect(parseDateBg(formatDateBg('2026-03-29'))).toBe('2026-03-29')
  })
})

describe('autoDots', () => {
  it('puts the dots in as digits are typed', () => {
    const steps = ['0', '08', '081', '0811', '08112', '081120', '0811202', '08112026']
    expect(steps.map(autoDots)).toEqual(['0', '08', '08.1', '08.11', '08.11.2', '08.11.20', '08.11.202', '08.11.2026'])
  })
  it('keeps going after its own dots', () => {
    expect(autoDots('08.112')).toBe('08.11.2')
    expect(autoDots('08.11.2026')).toBe('08.11.2026')
    expect(autoDots('08.11.20267')).toBe('08.11.2026')
  })
  it('leaves a date the person writes with their own dots', () => {
    expect(autoDots('8.11.26')).toBe('8.11.26')
    expect(autoDots('8.')).toBe('8.')
  })
  it('deleting back over a dot works', () => {
    expect(autoDots('08.1')).toBe('08.1')
    expect(autoDots('08.')).toBe('08')
  })
})
