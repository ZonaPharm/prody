/**
 * Roles of a person (decision 2026-11-12: one account can hold several roles,
 * e.g. Офис + Шофьор). What a person may see and do is the union of their roles.
 *
 * `users.roles` (text[]) is the truth. The old single `users.role` column
 * ('admin' | 'seller') is kept in step by a database trigger, so every existing
 * check on `role === 'admin'` and every RLS policy that reads it still works:
 * role = 'admin' when the roles hold 'admin', 'seller' otherwise.
 */

export const ROLES = ['admin', 'office', 'seller', 'driver', 'accountant'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Администратор',
  office: 'Офис',
  seller: 'Продавач',
  driver: 'Шофьор',
  accountant: 'Счетоводител',
}

/** One line under each tick in Настройки → Потребители. */
export const ROLE_HINT: Record<Role, string> = {
  admin: 'Всичко: продажби, отчети, каталог, настройки; въвежда, приема и разпределя доставките.',
  office: 'Етикетира, опакова и праща курсовете. Не вижда продажби и не приема доставки.',
  seller: 'Продава в избран магазин (може и Офис), прави заявки, приема пратките.',
  driver: 'Излиза най-отгоре в „Кой кара“ и вижда своите курсове в „Задачи“. Иначе всеки може да кара.',
  accountant: 'Само гледа продажбите и отчетите, без да променя.',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/**
 * The roles of a users row. Before the migration (or for a row it has not
 * touched) there is only the old `role`, which becomes a one-role list.
 */
export function rolesOf(profile: { roles?: unknown; role?: unknown } | null | undefined): Role[] {
  if (!profile) return []
  const list = Array.isArray(profile.roles) ? profile.roles.filter(isRole) : []
  if (list.length > 0) return sortRoles(list)
  return isRole(profile.role) ? [profile.role] : []
}

export function hasRole(profile: { roles?: unknown; role?: unknown } | null | undefined, role: Role): boolean {
  return rolesOf(profile).includes(role)
}

/** The legacy single role the database keeps in step (see the trigger). */
export function legacyRole(roles: readonly Role[]): 'admin' | 'seller' {
  return roles.includes('admin') ? 'admin' : 'seller'
}

/** Unique, in the order of ROLES, so the same set always looks the same. */
export function sortRoles(roles: readonly Role[]): Role[] {
  return ROLES.filter(r => roles.includes(r))
}

export function rolesText(roles: readonly Role[]): string {
  return sortRoles(roles).map(r => ROLE_LABEL[r]).join(', ')
}

/**
 * Only a seller belongs to a store (Владимир, 2026-11-12: anybody can also be a
 * seller, in any store, Офис included). Офис prepares the goods and does not sell
 * or see sales unless Продавач is ticked too.
 */
export function needsStore(roles: readonly Role[]): boolean {
  return roles.includes('seller')
}

export type RolesInput = { roles: unknown; store_id?: unknown }
export type RolesCheck =
  | { ok: true; roles: Role[]; store_id: string | null }
  | { ok: false; error: string }

/**
 * Checks the roles and the store an admin picked for a person.
 * - at least one known role;
 * - Продавач needs a store (any store, Офис included);
 * - without Продавач nobody keeps a store.
 */
export function checkRoles(input: RolesInput): RolesCheck {
  if (!Array.isArray(input.roles)) return { ok: false, error: 'Изберете поне една роля' }
  if (input.roles.some(r => !isRole(r))) return { ok: false, error: 'Непозната роля' }
  const roles = sortRoles(input.roles as Role[])
  if (roles.length === 0) return { ok: false, error: 'Изберете поне една роля' }

  const picked = typeof input.store_id === 'string' && input.store_id.trim() ? input.store_id.trim() : null
  if (needsStore(roles)) {
    if (!picked) return { ok: false, error: 'Изберете магазин за продавача' }
    return { ok: true, roles, store_id: picked }
  }
  return { ok: true, roles, store_id: null }
}

/**
 * May this users row sign for a trip as the driver? Any active account
 * (Владимир, 2026-11-12: „всеки може да кара пратки“). The Шофьор role only
 * puts the person first in the list and gives them the driver's „Задачи“.
 */
export function mayDrive(row: { is_active?: unknown } | null | undefined): boolean {
  return !!row && row.is_active !== false
}

/** Driver list order: people with the Шофьор role first, then by name. */
export function driverSort<T extends { name: string; driver: boolean }>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(b.driver) - Number(a.driver) || a.name.localeCompare(b.name, 'bg'))
}

/** Works with Доставки (receiving, labelling, packing, trips, „Задачи“ of Офис): Администратор and Офис. */
export function canWorkDeliveries(profile: { roles?: unknown; role?: unknown } | null | undefined): boolean {
  const r = rolesOf(profile)
  return r.includes('admin') || r.includes('office')
}

/** Sells at the till: Продавач (and Администратор, who may look as a seller). */
export function canSell(profile: { roles?: unknown; role?: unknown } | null | undefined): boolean {
  const r = rolesOf(profile)
  return r.includes('admin') || r.includes('seller')
}

/** Where a person starts after signing in. */
export function homePath(profile: { roles?: unknown; role?: unknown } | null | undefined): string {
  const r = rolesOf(profile)
  if (r.includes('admin')) return '/dashboard'
  if (r.includes('office')) return '/tasks'
  if (r.includes('seller')) return '/record-sale'
  if (r.includes('driver')) return '/my-tasks'
  return '/record-sale'
}
