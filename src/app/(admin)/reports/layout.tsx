import { requireAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** The page is a client component; the admin check lives here (Офис shares the admin area for Доставки only). */
export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return children
}
