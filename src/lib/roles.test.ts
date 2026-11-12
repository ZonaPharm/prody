import { describe, expect, it } from 'vitest'
import { canSell, canWorkDeliveries, checkRoles, hasRole, homePath, legacyRole, mayDrive, driverSort, needsStore, rolesOf, rolesText, sortRoles } from './roles'

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
  it('only a seller belongs to a store', () => {
    expect(needsStore(['seller'])).toBe(true)
    expect(needsStore(['office', 'seller'])).toBe(true)
    expect(needsStore(['office', 'driver'])).toBe(false)
    expect(needsStore(['admin', 'driver', 'accountant'])).toBe(false)
  })
})

describe('checkRoles', () => {
  it('needs at least one known role', () => {
    expect(checkRoles({ roles: [] })).toEqual({ ok: false, error: 'Изберете поне една роля' })
    expect(checkRoles({ roles: 'admin' }).ok).toBe(false)
    expect(checkRoles({ roles: ['admin', 'boss'] })).toEqual({ ok: false, error: 'Непозната роля' })
  })
  it('a seller needs a store and keeps it, any store (Офис too), next to any other role', () => {
    expect(checkRoles({ roles: ['seller'] }).ok).toBe(false)
    expect(checkRoles({ roles: ['seller', 'driver'], store_id: BOTEV }))
      .toEqual({ ok: true, roles: ['seller', 'driver'], store_id: BOTEV })
    expect(checkRoles({ roles: ['admin', 'seller'], store_id: OFFICE }))
      .toEqual({ ok: true, roles: ['admin', 'seller'], store_id: OFFICE })
  })
  it('Офис alone belongs to no store (it prepares the goods, does not sell)', () => {
    expect(checkRoles({ roles: ['driver', 'office'], store_id: OFFICE }))
      .toEqual({ ok: true, roles: ['office', 'driver'], store_id: null })
  })
  it('admin, driver and accountant alone belong to no store', () => {
    expect(checkRoles({ roles: ['admin'], store_id: BOTEV }))
      .toEqual({ ok: true, roles: ['admin'], store_id: null })
    expect(checkRoles({ roles: ['driver'] })).toEqual({ ok: true, roles: ['driver'], store_id: null })
  })
})

describe('mayDrive / driverSort', () => {
  it('any active account may drive', () => {
    expect(mayDrive({ roles: ['office', 'driver'], is_active: true } as any)).toBe(true)
    expect(mayDrive({ roles: ['seller'], is_active: true } as any)).toBe(true)
    expect(mayDrive({ is_active: null })).toBe(true)
    expect(mayDrive({ is_active: false })).toBe(false)
    expect(mayDrive(null)).toBe(false)
  })
  it('drivers first, then by name', () => {
    expect(driverSort([
      { name: 'Мира', driver: false }, { name: 'Ивайло', driver: true }, { name: 'Деси', driver: false },
    ]).map(d => d.name)).toEqual(['Ивайло', 'Деси', 'Мира'])
  })
})

describe('what a person may do', () => {
  it('Доставки: admin and Офис only', () => {
    expect(canWorkDeliveries({ roles: ['admin'] })).toBe(true)
    expect(canWorkDeliveries({ roles: ['office', 'driver'] })).toBe(true)
    expect(canWorkDeliveries({ roles: ['seller', 'driver'] })).toBe(false)
    expect(canWorkDeliveries({ roles: ['accountant'] })).toBe(false)
    expect(canWorkDeliveries({ role: 'admin' })).toBe(true)
    expect(canWorkDeliveries({ role: 'seller' })).toBe(false)
  })
  it('the till: sellers and admins; Офис alone does not sell', () => {
    expect(canSell({ roles: ['office'] })).toBe(false)
    expect(canSell({ roles: ['office', 'seller'] })).toBe(true)
    expect(canSell({ roles: ['driver'] })).toBe(false)
    expect(canSell({ role: 'seller' })).toBe(true)
  })
  it('start page by roles', () => {
    expect(homePath({ roles: ['admin', 'accountant'] })).toBe('/dashboard')
    expect(homePath({ roles: ['office', 'seller', 'driver'] })).toBe('/tasks')
    expect(homePath({ roles: ['seller', 'driver'] })).toBe('/record-sale')
    expect(homePath({ roles: ['driver'] })).toBe('/my-tasks')
    expect(homePath({ role: 'seller' })).toBe('/record-sale')
  })
})
