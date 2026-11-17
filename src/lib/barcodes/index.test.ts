import { describe, it, expect } from 'vitest'
import {
  ean13CheckDigit, isValidEan13, isInternalBarcode, labelCode, matchesCode,
  looksLikeCode, factoryBarcodeProblem, normalizeCode,
} from './index'

describe('ean13CheckDigit', () => {
  it('matches known EANs', () => {
    expect(ean13CheckDigit('400638133393')).toBe('1')
    expect(ean13CheckDigit('380012345678')).toBe(String((10 - ((3+0+1+3+5+7) + 3*(8+0+2+4+6+8)) % 10) % 10))
  })
  it('matches what the database gives (same formula as ean13_check_digit)', () => {
    expect(ean13CheckDigit('200000000001')).toBe('5')
    expect(ean13CheckDigit('200000000002')).toBe('2')
    expect(ean13CheckDigit('200000000050')).toBe('3')
  })
  it('refuses anything but 12 digits', () => {
    expect(() => ean13CheckDigit('123')).toThrow()
    expect(() => ean13CheckDigit('20000000000a')).toThrow()
  })
})

describe('isValidEan13 / isInternalBarcode', () => {
  it('checks the last digit', () => {
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
    expect(isValidEan13('400638133393')).toBe(false)
  })
  it('knows our own codes', () => {
    expect(isInternalBarcode('2000000000015')).toBe(true)
    expect(isInternalBarcode('2000000000016')).toBe(false)
    expect(isInternalBarcode('4006381333931')).toBe(false)
  })
})

describe('labelCode', () => {
  it('prints the factory barcode first', () => {
    expect(labelCode({ barcode: '4006381333931', internal_barcode: '2000000000015', sku: 'X' })).toBe('4006381333931')
  })
  it('falls back to the internal code, then SKU', () => {
    expect(labelCode({ barcode: '  ', internal_barcode: '2000000000015', sku: 'X' })).toBe('2000000000015')
    expect(labelCode({ barcode: null, internal_barcode: null, sku: ' X1 ' })).toBe('X1')
    expect(labelCode({})).toBe('')
  })
})

describe('matchesCode', () => {
  const p = { barcode: '4006381333931', internal_barcode: '2000000000015' }
  it('finds a product by either code, spaces ignored', () => {
    expect(matchesCode(p, '4006381333931')).toBe(true)
    expect(matchesCode(p, ' 2000000000015 ')).toBe(true)
  })
  it('wants the whole code', () => {
    expect(matchesCode(p, '400638')).toBe(false)
    expect(matchesCode(p, '')).toBe(false)
    expect(matchesCode({ barcode: null, internal_barcode: null }, '')).toBe(false)
  })
})

describe('looksLikeCode', () => {
  it('is digits, 6 or more', () => {
    expect(looksLikeCode('2000000000015')).toBe(true)
    expect(looksLikeCode('12345')).toBe(false)
    expect(looksLikeCode('крем')).toBe(false)
  })
})

describe('factoryBarcodeProblem', () => {
  it('accepts empty and good codes', () => {
    expect(factoryBarcodeProblem('')).toBeNull()
    expect(factoryBarcodeProblem(' 4006381333931 ')).toBeNull()
    expect(factoryBarcodeProblem('96385074')).toBeNull()
    expect(factoryBarcodeProblem('ABC-123')).toBeNull()
  })
  it('refuses our own internal code in the factory field', () => {
    expect(factoryBarcodeProblem('2000000000015')).toMatch(/вътрешен/)
  })
  it('refuses a 13-digit code with a wrong check digit', () => {
    expect(factoryBarcodeProblem('4006381333932')).toMatch(/контролна/)
  })
  it('refuses spaces inside and non-latin text', () => {
    expect(factoryBarcodeProblem('400 638')).toMatch(/интервали/)
    expect(factoryBarcodeProblem('баркод')).toMatch(/латински/)
  })
})

describe('normalizeCode', () => {
  it('trims', () => {
    expect(normalizeCode('  12 ')).toBe('12')
    expect(normalizeCode(null)).toBe('')
  })
})
