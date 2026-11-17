import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, code128Bars, code128Encodable, code128Symbols, code128Widths } from './code128'

// Reads the widths back the way a scanner does: 6 widths a symbol, stop last.
function decode(widths: number[]): string {
  const symbols: number[] = []
  for (let i = 0; i < widths.length - 7; i += 6) {
    const p = widths.slice(i, i + 6).join('')
    const v = CODE128_PATTERNS.indexOf(p)
    expect(v).toBeGreaterThanOrEqual(0)
    symbols.push(v)
  }
  expect(widths.slice(-7).join('')).toBe('2331112')
  const check = symbols.pop()!
  let sum = symbols[0]
  for (let k = 1; k < symbols.length; k++) sum += symbols[k] * k
  expect(sum % 103).toBe(check)
  let set = symbols[0] === 105 ? 'C' : 'B'
  let out = ''
  for (const s of symbols.slice(1)) {
    // In set B 99 is "to set C"; in set C 100 is "to set B" (and 99 is the digits 99).
    if (set === 'B' && s === 99) { set = 'C'; continue }
    if (set === 'C' && s === 100) { set = 'B'; continue }
    out += set === 'C' ? String(s).padStart(2, '0') : String.fromCharCode(s + 32)
  }
  return out
}

describe('code128', () => {
  it('has 107 patterns of 11 modules (stop 13), all different', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    CODE128_PATTERNS.forEach((p, i) => {
      const sum = [...p].reduce((s, c) => s + Number(c), 0)
      expect(sum).toBe(i === 106 ? 13 : 11)
    })
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
  })

  it('reads back what it encodes', () => {
    for (const t of ['3800123456789', 'ABC-12', 'a', '12', '123', 'X12345', '12345X', 'SKU 0042 b', '99', '1234567']) {
      expect(decode(code128Widths(t)!)).toBe(t)
    }
  })

  it('uses code set C for an EAN, so it stays short', () => {
    const s = code128Symbols('3800123456789')!
    expect(s[0]).toBe(105)
    // start C, 6 pairs, code B, '9', checksum
    expect(s).toHaveLength(10)
    expect(s.slice(1, 7)).toEqual([38, 0, 12, 34, 56, 78])
    expect(s[7]).toBe(100)
  })

  it('known checksum: "PJJ123C" in code set B', () => {
    // P=48 J=42 J=42 1=17 2=18 3=19 C=35 → (104 + 48 + 84 + 126 + 68 + 90 + 114 + 245) % 103 = 879 % 103 = 55
    const s = code128Symbols('PJJ123C')!
    expect(s[0]).toBe(104)
    expect(s.at(-1)).toBe(55)
  })

  it('refuses what it cannot encode', () => {
    expect(code128Encodable('')).toBe(false)
    expect(code128Encodable('Крем')).toBe(false)
    expect(code128Encodable('x'.repeat(49))).toBe(false)
    expect(code128Symbols('Крем')).toBeNull()
    expect(code128Bars('')).toBeNull()
  })

  it('bars start at 0 and the total is the sum of the widths', () => {
    const b = code128Bars('3800123456789')!
    const w = code128Widths('3800123456789')!
    expect(b.bars[0][0]).toBe(0)
    expect(b.total).toBe(w.reduce((s, x) => s + x, 0))
    expect(b.bars).toHaveLength(Math.ceil(w.length / 2))
  })
})
