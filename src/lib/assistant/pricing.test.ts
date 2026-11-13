import { describe, expect, it } from 'vitest'
import { checkCap, costUsd, isPeak, monthStartIso, priceOf, splitUsage } from './pricing'

// Friday 13 Nov 2026: 12:00 UTC is off-peak, 08:00 UTC is peak.
const OFF = new Date('2026-11-13T12:00:00Z')
const PEAK = new Date('2026-11-13T08:00:00Z')

describe('costUsd', () => {
  it('prices DeepSeek Flash off-peak: cache hit, cache miss, output', () => {
    // 100k hit × 0.003 + 20k miss × 0.15 + 2k out × 0.6 = 300 + 3000 + 1200 = 4500 / 1e6
    expect(costUsd('deepseek-flash', {
      prompt_cache_hit_tokens: 100_000, prompt_cache_miss_tokens: 20_000, completion_tokens: 2_000,
    }, OFF)).toBeCloseTo(0.0045, 6)
  })
  it('doubles in peak hours', () => {
    expect(costUsd('deepseek-flash', { prompt_cache_miss_tokens: 1_000_000 }, PEAK)).toBeCloseTo(0.3, 6)
  })
  it('prices V4 Pro', () => {
    expect(costUsd('deepseek-v4-pro', { completion_tokens: 1_000_000 }, OFF)).toBeCloseTo(1.98, 6)
  })
  it('treats missing or null counts as zero', () => {
    expect(costUsd('deepseek-flash', { prompt_cache_miss_tokens: 1_000_000, completion_tokens: null }, OFF)).toBeCloseTo(0.15, 6)
  })
  it('without a hit/miss split, counts the whole prompt as a miss', () => {
    expect(splitUsage({ prompt_tokens: 500, prompt_cache_hit_tokens: 200, completion_tokens: 7 })).toEqual({ hit: 200, miss: 300, output: 7 })
  })
  it('prices an unknown model as the dearest known, never as free', () => {
    expect(priceOf('deepseek-something-new').miss).toBe(0.66)
  })
})

describe('isPeak', () => {
  it('follows DeepSeek peak hours in UTC on weekdays', () => {
    expect(isPeak(new Date('2026-11-13T01:00:00Z'))).toBe(true)
    expect(isPeak(new Date('2026-11-13T04:00:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-11-13T05:59:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-11-13T09:59:00Z'))).toBe(true)
    expect(isPeak(new Date('2026-11-13T10:00:00Z'))).toBe(false)
  })
  it('weekends are off-peak', () => {
    expect(isPeak(new Date('2026-11-14T08:00:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-11-15T02:00:00Z'))).toBe(false)
  })
})

describe('checkCap', () => {
  it('allows below the cap', () => expect(checkCap(10, 50).ok).toBe(true))
  it('stops at the cap', () => {
    const r = checkCap(50, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('50.00 $')
  })
  it('a zero cap switches it off', () => expect(checkCap(0, 0).ok).toBe(false))
})

describe('monthStartIso', () => {
  it('starts the month in Sofia time (a little early rather than late)', () => {
    // 1 Nov 2026 00:30 Sofia (UTC+2) = 31 Oct 22:30 UTC: already November.
    expect(monthStartIso(new Date('2026-10-31T22:30:00Z'))).toBe('2026-10-31T21:00:00.000Z')
    // 15 Jul 2026: July 1st 00:00 Sofia (UTC+3) = 30 Jun 21:00 UTC.
    expect(monthStartIso(new Date('2026-07-15T10:00:00Z'))).toBe('2026-06-30T21:00:00.000Z')
  })
})
