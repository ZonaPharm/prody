import { notFound, redirect } from 'next/navigation'
import { requireAdmin, type AppUser } from '@/lib/auth'
import { deliveriesEnabledFor } from './feature'

/**
 * For the delivery pages: an admin (sellers go to their POS, as everywhere in
 * the admin area), an active account, and the feature switch on for them —
 * otherwise the page does not exist (404).
 */
export async function requireDeliveriesAdmin(): Promise<AppUser> {
  const user = await requireAdmin()
  if ((user as AppUser & { is_active?: boolean | null }).is_active === false) redirect('/login')
  if (!deliveriesEnabledFor(user.email)) notFound()
  return user
}
