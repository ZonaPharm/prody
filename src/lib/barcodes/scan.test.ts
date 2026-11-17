import { describe, it, expect } from 'vitest'
import { findByScan, ScanBuffer } from './scan'

type P = { id: string; barcode: string | null; internal_barcode: string | null }
const krem: P = { id: 'a', barcode: '4006381333931', internal_barcode: '2000000000015' }
const chai: P = { id: 'b', barcode: null, internal_barcode: '2000000000022' }
const gone: P = { id: 'c', barcode: null, internal_barcode: '2000000000039' }

describe('findByScan', () => {
  it('adds a product in stock by the factory barcode or the internal code', () => {
    expect(findByScan('4006381333931', [krem, chai], [gone])).toEqual({ kind: 'add', product: krem })
    expect(findByScan(' 2000000000022\n', [krem, chai], [gone])).toEqual({ kind: 'add', product: chai })
  })
  it('says when the product has run out here', () => {
    expect(findByScan('2000000000039', [krem, chai], [gone])).toEqual({ kind: 'out', product: gone })
  })
  it('says when no product has the code', () => {
    expect(findByScan('5555555555555', [krem], [gone])).toEqual({ kind: 'none', code: '5555555555555' })
  })
})

describe('ScanBuffer', () => {
  const type = (b: ScanBuffer, text: string, start: number, gap: number) => {
    let t = start
    for (const ch of text) { b.key(ch, t); t += gap }
    return b.key('Enter', t)
  }
  it('returns a code typed at scanner speed', () => {
    expect(type(new ScanBuffer(), '2000000000015', 0, 10)).toBe('2000000000015')
  })
  it('ignores slow typing', () => {
    expect(type(new ScanBuffer(), '2000000000015', 0, 200)).toBeNull()
  })
  it('ignores short bursts and lone Enter', () => {
    const b = new ScanBuffer()
    expect(type(b, '123', 0, 5)).toBeNull()
    expect(b.key('Enter', 100)).toBeNull()
  })
  it('starts again after a pause', () => {
    const b = new ScanBuffer()
    b.key('9', 0)
    b.key('9', 1000)
    expect(type(b, '2000000000015', 2000, 5)).toBe('2000000000015')
  })
  it('skips keys like Shift', () => {
    const b = new ScanBuffer()
    b.key('Shift', 0)
    expect(type(b, 'ABC-123', 1, 5)).toBe('ABC-123')
  })
})
