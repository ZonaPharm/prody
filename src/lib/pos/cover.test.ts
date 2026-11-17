import { describe, expect, it } from 'vitest'
import { clearCover, coverKey, coverStartStore, needsCoverQuestion, readCover, saveCover, type CoverStorage } from './cover'

const HOME = 'botev'
const OTHER = 'zaimov'

function memory(): CoverStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: k => { data.delete(k) },
  }
}

describe('needsCoverQuestion', () => {
  it('no question in the home store', () => {
    expect(needsCoverQuestion({ homeStoreId: HOME, storeId: HOME, confirmedStoreId: null })).toBe(false)
  })
  it('asks the first time in another store', () => {
    expect(needsCoverQuestion({ homeStoreId: HOME, storeId: OTHER, confirmedStoreId: null })).toBe(true)
  })
  it('does not ask again once confirmed for that store today', () => {
    expect(needsCoverQuestion({ homeStoreId: HOME, storeId: OTHER, confirmedStoreId: OTHER })).toBe(false)
  })
  it('asks again for a third store', () => {
    expect(needsCoverQuestion({ homeStoreId: HOME, storeId: 'burgas', confirmedStoreId: OTHER })).toBe(true)
  })
  it('never asks someone without a home store (an admin looking as a seller)', () => {
    expect(needsCoverQuestion({ homeStoreId: null, storeId: OTHER, confirmedStoreId: null })).toBe(false)
  })
})

describe('coverStartStore', () => {
  const storeIds = [HOME, OTHER]
  it('opens on the store confirmed today', () => {
    expect(coverStartStore({ urlStoreId: null, homeStoreId: HOME, confirmedStoreId: OTHER, storeIds })).toBe(OTHER)
  })
  it('the address wins', () => {
    expect(coverStartStore({ urlStoreId: HOME, homeStoreId: HOME, confirmedStoreId: OTHER, storeIds })).toBeNull()
  })
  it('nothing to change without a cover, or for an inactive store', () => {
    expect(coverStartStore({ urlStoreId: null, homeStoreId: HOME, confirmedStoreId: null, storeIds })).toBeNull()
    expect(coverStartStore({ urlStoreId: null, homeStoreId: HOME, confirmedStoreId: 'closed', storeIds })).toBeNull()
  })
})

describe('storage', () => {
  it('is per person and per day', () => {
    const s = memory()
    saveCover(s, 'u1', '2026-11-12', OTHER)
    expect(readCover(s, 'u1', '2026-11-12')).toBe(OTHER)
    expect(readCover(s, 'u1', '2026-11-13')).toBeNull()
    expect(readCover(s, 'u2', '2026-11-12')).toBeNull()
    expect(s.data.has(coverKey('u1', '2026-11-12'))).toBe(true)
    clearCover(s, 'u1', '2026-11-12')
    expect(readCover(s, 'u1', '2026-11-12')).toBeNull()
  })
  it('survives a storage that throws or is missing', () => {
    const broken = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
    expect(readCover(broken, 'u1', 'd')).toBeNull()
    expect(() => saveCover(broken, 'u1', 'd', OTHER)).not.toThrow()
    expect(() => clearCover(broken, 'u1', 'd')).not.toThrow()
    expect(readCover(null, 'u1', 'd')).toBeNull()
  })
})
