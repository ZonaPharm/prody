import { checkRoles, legacyRole, type RolesCheck } from '@/lib/roles'
import { isMissingTableError } from '@/lib/missing-table'

/**
 * Server side of Настройки → Потребители: the roles an admin ticked, checked
 * in src/lib/roles.ts. An older page may still send a single `role`; it becomes
 * a one-role list.
 */
export function rolesFromBody(body: { roles?: unknown; role?: unknown; store_id?: unknown }): RolesCheck {
  const roles = body.roles !== undefined ? body.roles : (typeof body.role === 'string' ? [body.role] : undefined)
  return checkRoles({ roles, store_id: body.store_id })
}

/** The users row fields for checked roles (role is also set by the database trigger; written here too so both always agree). */
export function rolesRow(check: Extract<RolesCheck, { ok: true }>) {
  return { roles: check.roles, role: legacyRole(check.roles), store_id: check.store_id }
}

/** A failed users update in Bulgarian; the roles column missing means the migration has not run yet. */
export function usersWriteError(error: unknown): string {
  if (isMissingTableError(error)) return 'Ролите още не са в базата: пуснете миграцията 20261112_user_roles.sql'
  return (error as { message?: string })?.message || 'Записът не мина'
}
