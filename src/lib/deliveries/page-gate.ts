import { notFound, redirect } from 'next/navigation'
import { getEffectiveRole, requireAuth, type AppUser } from '@/lib/auth'
import { canWorkDeliveries, homePath } from '@/lib/roles'
import { deliveriesEnabledFor } from './feature'

/**
 * For the delivery pages: Администратор or Офис (src/lib/roles.ts), an active
 * account, and the feature switch on for them, otherwise the page does not exist
 * (404). An admin looking as a seller goes to the till, as everywhere in the
 * admin area; anyone else goes to their own start page.
 */
export async function requireDeliveriesAdmin(opts: { adminOnly?: boolean } = {}): Promise<AppUser> {
  const user = await requireAuth()
  if ((user as AppUser & { is_active?: boolean | null }).is_active === false) redirect('/login')
  if (user.role === 'admin' && (await getEffectiveRole(user)) !== 'admin') redirect('/record-sale')
  if (!canWorkDeliveries(user)) redirect(homePath(user))
  if (!deliveriesEnabledFor(user.email)) notFound()
  // Entering, receiving, distributing and problems: admins only; Офис goes to its tasks.
  if (opts.adminOnly && user.role !== 'admin') redirect('/tasks')
  return user
}
