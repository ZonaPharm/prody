import { describe, expect, it } from 'vitest'
import { checkRoles, hasRole, legacyRole, mayDrive, needsStore, rolesOf, rolesText, sortRoles } from './roles'

const OFFICE = '11111111-1111-1111-1111-111111111111'
const BOTEV = '22222222-2222-2222-2222-222222222222'

describe('rolesOf', () => {
  it('reads the roles list, in a fixed order, unknown ones dropped', () => {
    expect(rolesOf({ roles: ['driver', 'office', 'boss'], role: 'seller' })).toEqual(['office', 'driver'])
  })
  it('falls back to the old single role before the migration', () => {
    expect(rolesOf({ role: 'admin' })).toEqual(['admin'])
    expect(rolesOf({ roles: [], role: 'seller' })).toEqual(['seller'])
    expect(rolesOf({ roles: null, role: 'seller' })).toEqual(['seller'])
  })
  it('is empty for nothing', () => {
    expect(rolesOf(null)).toEqual([])
    expect(rolesOf({ role: 'x' })).toEqual([])
  })
  it('hasRole looks at the whole set', () => {
    expect(hasRole({ roles: ['office', 'driver'], role: 'seller' }, 'driver')).toBe(true)
    expect(hasRole({ roles: ['office', 'driver'], role: 'seller' }, 'seller')).toBe(false)
    expect(hasRole({ role: 'admin' }, 'admin')).toBe(true)
  })
})

describe('legacyRole', () => {
  it('is admin when admin is among the roles, seller otherwise', () => {
    expect(legacyRole(['admin', 'driver'])).toBe('admin')
    expect(legacyRole(['office', 'driver'])).toBe('seller')
    expect(legacyRole(['accountant'])).toBe('seller')
  })
})

describe('sortRoles / rolesText', () => {
  it('dedupes and orders', () => {
    expect(sortRoles(['driver', 'admin', 'driver'])).toEqual(['admin', 'driver'])
    expect(rolesText(['driver', 'office'])).toBe('Офис, Шофьор')
  })
})

describe('needsStore', () => {
  it('sellers and Офис work in a shop, the others do not', () => {
    expect(needsStore(['seller'])).toBe(true)
    expect(needsStore(['office', 'driver'])).toBe(true)
    expect(needsStore(['admin', 'driver', 'accountant'])).toBe(false)
  })
})

describe('checkRoles', () => {
  it('needs at least one known role', () => {
    expect(checkRoles({ roles: [] }, OFFICE)).toEqual({ ok: false, error: 'Изберете поне една роля' })
    expect(checkRoles({ roles: 'admin' }, OFFICE).ok).toBe(false)
    expect(checkRoles({ roles: ['admin', 'boss'] }, OFFICE)).toEqual({ ok: false, error: 'Непозната роля' })
  })
  it('a seller needs a store and keeps it', () => {
    expect(checkRoles({ roles: ['seller'] }, OFFICE).ok).toBe(false)
    expect(checkRoles({ roles: ['seller', 'driver'], store_id: BOTEV }, OFFICE))
      .toEqual({ ok: true, roles: ['seller', 'driver'], store_id: BOTEV })
  })
  it('Офис is put in Офис, and refuses another store', () => {
    expect(checkRoles({ roles: ['driver', 'office'] }, OFFICE))
      .toEqual({ ok: true, roles: ['office', 'driver'], store_id: OFFICE })
    expect(checkRoles({ roles: ['office', 'seller'], store_id: OFFICE }, OFFICE).ok).toBe(true)
    expect(checkRoles({ roles: ['office', 'seller'], store_id: BOTEV }, OFFICE).ok).toBe(false)
    expect(checkRoles({ roles: ['office'] }, null).ok).toBe(false)
  })
  it('admin, driver and accountant alone belong to no store', () => {
    expect(checkRoles({ roles: ['admin'], store_id: BOTEV }, OFFICE))
      .toEqual({ ok: true, roles: ['admin'], store_id: null })
    expect(checkRoles({ roles: ['driver'] }, OFFICE)).toEqual({ ok: true, roles: ['driver'], store_id: null })
  })
})

describe('mayDrive', () => {
  it('needs the Шофьор role and an active account', () => {
    expect(mayDrive({ roles: ['office', 'driver'], is_active: true })).toBe(true)
    expect(mayDrive({ roles: ['seller'], is_active: true })).toBe(false)
    expect(mayDrive({ roles: ['driver'], is_active: false })).toBe(false)
    expect(mayDrive(null)).toBe(false)
  })
  it('before the migration (no roles on the row) any active account may drive', () => {
    expect(mayDrive({ is_active: true })).toBe(true)
    expect(mayDrive({ is_active: null })).toBe(true)
  })
})
