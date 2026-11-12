import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { deliveriesActive } from '@/lib/deliveries/feature'
import { getStoreShipments } from '@/lib/deliveries/work'
import { daysWaiting } from '@/lib/deliveries/queue'
import { formatShipmentNumber } from '@/lib/deliveries/format'
import { SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE, boxesText } from '@/lib/deliveries/trip-format'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { isUuid } from '@/lib/deliveries/api'
import { AsAdminLink } from '@/components/admin/as-admin-link'

export const dynamic = 'force-dynamic'

/**
 * "Пратки": what Офис sent to this store. The ones on the way wait for the store's checklist.
 *
 * An admin looking "as a seller" has no store of their own: they pick a store and see its
 * shipments read-only, with who in that store signs for them (or how to add someone).
 */
export default async function MyShipmentsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  if (!deliveriesActive()) notFound()
  const user = await requireAuth()
  const sp = await searchParams
  const supabase = await createServerSupabaseClient()
  const adminView = !user.store_id && user.role === 'admin'
  // An admin lands on the first store with a shipment on the way, so there is nothing to look for.
  const admin = adminView ? await adminContext(supabase, sp.store && isUuid(sp.store) ? sp.store : null) : null
  const storeId = user.store_id ?? admin?.storeId ?? null
  const rows = storeId ? await getStoreShipments(supabase, storeId) : []
  const waiting = rows.filter(r => r.status === 'sent')
  const done = rows.filter(r => r.status !== 'sent')

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Пратки</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Стоката от Офис. Тя е във Вашата наличност от момента, в който шофьорът тръгне. Когато кашоните пристигнат, отметнете пратката ред по ред.
        </p>
      </div>

      {!user.store_id && !adminView && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Акаунтът Ви още не е към магазин, затова не виждате пратки. Помолете администратор да Ви сложи магазина в Настройки → Потребители.
        </p>
      )}

      {admin && (
        <section className="space-y-3 rounded-lg border bg-white p-4">
          <p className="text-sm">
            Вие сте администратор и нямате свой магазин. Пратката се отмята от <b>човек от магазина</b>, с неговия акаунт.
            Изберете магазин, за да видите пратките му и кой може да ги приеме.
          </p>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
            {admin.stores.map(st => (
              <Link key={st.id} href={`/my-shipments?store=${st.id}`}
                className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm',
                  st.id === storeId ? 'border-primary bg-primary text-primary-foreground' : 'bg-white hover:bg-slate-50')}>
                {st.name}{st.onWay > 0 && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', st.id === storeId ? 'bg-white/20' : 'bg-blue-100 text-blue-800')}>{st.onWay}</span>}
              </Link>
            ))}
          </div>
          {storeId && admin.picked && (
            admin.sellers.length > 0 ? (
              <p className="rounded-md bg-slate-50 p-3 text-sm">
                В <b>{admin.picked}</b> пратките приема: <b>{admin.sellers.join(', ')}</b>. Влиза със своя акаунт → „Пратки“ → „Отметни“.
              </p>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                В <b>{admin.picked}</b> няма продавач с акаунт, затова никой не може да приеме пратките.{' '}
                <AsAdminLink href="/settings?tab=users" className="font-medium underline">Добавете продавач за {admin.picked}</AsAdminLink> в Настройки → Потребители.
              </p>
            )
          )}
        </section>
      )}

      <div className={cn('grid items-start gap-4', done.length > 0 && 'xl:grid-cols-2')}>
      {storeId && (
        <section className="space-y-2">
          <h2 className="font-semibold">Чакат потвърждение ({waiting.length})</h2>
          {waiting.length === 0 ? (
            <p className="rounded-lg border bg-white p-4 text-sm text-muted-foreground">Няма пратки на път.</p>
          ) : (
            <ul className="rounded-lg border bg-white divide-y">
              {waiting.map(r => {
                const days = daysWaiting(r.sent_at)
                return (
                  <li key={r.id}>
                    <RowLink admin={adminView} href={adminView ? `/deliveries/trips/${r.trip_id}` : `/my-shipments/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50" testId="waiting-shipment">
                      <span className="font-semibold tabular-nums">{formatShipmentNumber(r.number)}</span>
                      <span className="text-sm">{r.lines} {r.lines === 1 ? 'ред' : 'реда'}, {r.units} бр.{r.box_count ? `, ${boxesText(r.box_count)}` : ''}</span>
                      <span className="text-sm text-muted-foreground">
                        {[r.sent_at ? `тръгнала ${sofiaDateTime(r.sent_at)}` : 'на път', r.sender ? `шофьор ${r.sender}` : ''].filter(Boolean).join(', ')}
                      </span>
                      {days >= 1 && <span className="text-xs text-amber-700">чака от {days} {days === 1 ? 'ден' : 'дни'}</span>}
                      <span className="ml-auto text-sm font-medium text-blue-700">{adminView ? 'Курсът →' : 'Отметни →'}</span>
                    </RowLink>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Приети</h2>
          <ul className="rounded-lg border bg-white divide-y">
            {done.slice(0, 50).map(r => (
              <li key={r.id}>
                <RowLink admin={adminView} href={adminView ? `/deliveries/trips/${r.trip_id}` : `/my-shipments/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                  <span className="font-semibold tabular-nums">{formatShipmentNumber(r.number)}</span>
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs', SHIPMENT_STATUS_TONE[r.status])}>{SHIPMENT_STATUS_LABEL[r.status]}</span>
                  <span>{r.units} бр.</span>
                  <span className="text-muted-foreground">{[r.received_at ? sofiaDateTime(r.received_at) : '', r.receiver ?? ''].filter(Boolean).join(', ')}</span>
                </RowLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  )
}

/** For an admin without a store: the stores (with shipments on the way first), the one shown, and who there can accept. */
async function adminContext(supabase: any, requested: string | null) {
  const [{ data: stores }, { data: onWay }] = await Promise.all([
    supabase.from('stores').select('id, name, is_warehouse').eq('is_active', true).eq('is_warehouse', false).order('name'),
    supabase.from('shipments').select('store_id').eq('status', 'sent'),
  ])
  const count = new Map<string, number>()
  for (const r of (onWay ?? []) as { store_id: string }[]) count.set(r.store_id, (count.get(r.store_id) ?? 0) + 1)
  const list = ((stores ?? []) as { id: string; name: string }[])
    .map(st => ({ id: st.id, name: st.name, onWay: count.get(st.id) ?? 0 }))
    .sort((a, b) => (b.onWay > 0 ? 1 : 0) - (a.onWay > 0 ? 1 : 0) || a.name.localeCompare(b.name, 'bg'))
  const shown = list.find(st => st.id === requested) ?? list.find(st => st.onWay > 0) ?? null
  const { data: sellers } = shown
    ? await supabase.from('users').select('display_name').eq('store_id', shown.id).eq('role', 'seller').eq('is_active', true).order('display_name')
    : { data: [] }
  return {
    stores: list,
    storeId: shown?.id ?? null,
    picked: shown?.name ?? null,
    sellers: ((sellers ?? []) as { display_name: string }[]).map(u => u.display_name),
  }
}

/** The store's checklist for a seller; for an admin, the trip in the admin view. */
function RowLink({ admin, href, className, testId, children }: { admin: boolean; href: string; className: string; testId?: string; children: React.ReactNode }) {
  if (admin) return <AsAdminLink href={href} className={className}>{children}</AsAdminLink>
  return <Link href={href} className={className} data-testid={testId}>{children}</Link>
}
