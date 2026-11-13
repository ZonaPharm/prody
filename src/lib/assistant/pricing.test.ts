import { describe, expect, it } from 'vitest'
import { checkCap, costUsd, monthStartIso, priceOf } from './pricing'

describe('costUsd', () => {
  it('prices Opus 5.5: input, cache write 1.25×, cache read, output', () => {
    // 10k in × 4 + 2k write × 5 + 50k read × 0.2 + 1k out × 20 = 40000+10000+10000+20000 = 80000 / 1e6
    expect(costUsd('claude-opus-5-5', {
      input_tokens: 10_000, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 50_000, output_tokens: 1_000,
    })).toBeCloseTo(0.08, 6)
  })
  it('treats missing or null counts as zero', () => {
    expect(costUsd('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: null })).toBe(4)
  })
  it('prices an unknown model as the dearest known, never as free', () => {
    expect(priceOf('claude-something-new').input).toBe(5)
    expect(costUsd('claude-something-new', { output_tokens: 1_000_000 })).toBe(25)
  })
  it('matches a suffixed model id on its prefix', () => {
    expect(priceOf('claude-sonnet-5-5-20261101').input).toBe(2)
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
