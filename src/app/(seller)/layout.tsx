// src/app/(seller)/layout.tsx

import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SellerLayoutClient } from './layout-client'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { countWaitingShipments } from '@/lib/deliveries/work'
import { createAdminClient } from '@/lib/supabase/admin'
import { taskBadge } from '@/lib/deliveries/tasks-data'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/record-sale', label: 'Запиши продажба' },
  { href: '/my-sales', label: 'Моите продажби' },
  { href: '/my-requests', label: 'Заявки' },
]

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()

  // Count requests waiting for seller confirmation (delivered)
  let requestBadge = 0
  try {
    const { count } = await (supabase.from('stock_requests') as any)
      .select('*', { count: 'exact', head: true })
      .eq('requested_by', user.id)
      .eq('status', 'delivered')
    requestBadge = count || 0
  } catch {}

  // "Пратки": shipments from Офис for this store, while deliveries are on
  // anywhere (src/lib/deliveries/feature.ts). The badge counts those waiting
  // for the store's checklist.
  const shipmentsOn = deliveriesActive()
  let shipmentBadge = 0
  let taskCount = 0
  if (shipmentsOn) {
    ;[shipmentBadge, taskCount] = await Promise.all([
      countWaitingShipments(supabase, user.store_id).catch(() => 0),
      // "Задачи": new notifications and the trips this person drives; shipments
      // to accept are counted on "Пратки" and added here too.
      taskBadge(supabase, createAdminClient(), { role: 'seller', userId: user.id, storeId: user.store_id ?? null }).catch(() => 0),
    ])
  }
  const items = shipmentsOn
    ? [...navItems, { href: '/my-shipments', label: 'Пратки' }, { href: '/my-tasks', label: 'Задачи' }]
    : navItems

  return (
    <SellerLayoutClient
      navItems={items}
      displayName={user.display_name}
      isAdminImpersonating={user.role === 'admin' && effectiveRole === 'seller'}
      requestBadge={requestBadge}
      shipmentBadge={shipmentBadge}
      taskBadge={shipmentsOn ? taskCount + shipmentBadge : undefined}
    >
      {children}
    </SellerLayoutClient>
  )
}
