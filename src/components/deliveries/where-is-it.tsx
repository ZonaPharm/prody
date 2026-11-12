import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { STAGE_ORDER, STAGE_TONE, whereSummary, type WherePart, type Whereabouts } from '@/lib/deliveries/track'
import { formatShipmentNumber, formatTripNumber } from '@/lib/deliveries/format'
import { cn } from '@/lib/utils'

/**
 * "Къде е сега" for one delivery line: a bar with every unit in its stage, one
 * sentence on what it waits for, and a row per stage and store. A row with work
 * to do now links to the screen where it is done.
 */
export function WhereIsIt({ w, storeName, warehouseName, labelHref, compact, oneColumn, rowsOnly }: {
  w: Whereabouts
  storeName: (id: string) => string
  warehouseName: string
  /** Where "Чака етикет" leads, e.g. "Етикетиране" filtered to the delivery. */
  labelHref?: string
  /** Bar and sentence only, no rows. */
  compact?: boolean
  /** Rows under each other also on a wide screen (narrow cards). */
  oneColumn?: boolean
  /** Rows only, no bar and sentence (they are shown above already). */
  rowsOnly?: boolean
}) {
  const total = STAGE_ORDER.reduce((s, k) => s + w.totals[k], 0)
  return (
    <div className="space-y-2">
      {!rowsOnly && <>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {STAGE_ORDER.map(k => w.totals[k] > 0 && (
          <span key={k} className={STAGE_TONE[k].bar} style={{ width: `${(w.totals[k] / total) * 100}%` }} />
        ))}
      </div>
      <p className="text-sm font-medium">{whereSummary(w)}</p>
      </>}
      {!compact && (
        <ul className={cn('grid gap-x-6 gap-y-1', oneColumn ? 'max-w-2xl' : 'md:grid-cols-2')}>
          {w.parts.map((p, i) => (
            <PartRow key={i} p={p} w={w} storeName={storeName} warehouseName={warehouseName} labelHref={labelHref} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PartRow({ p, w, storeName, warehouseName, labelHref }: {
  p: WherePart
  w: Whereabouts
  storeName: (id: string) => string
  warehouseName: string
  labelHref?: string
}) {
  const store = p.store_id ? storeName(p.store_id) : warehouseName
  const trip = p.trip_number != null ? `${formatTripNumber(p.trip_number)}${p.shipment_number != null ? `, ${formatShipmentNumber(p.shipment_number)}` : ''}` : ''
  let text: React.ReactNode
  let href: string | undefined
  switch (p.stage) {
    case 'not_received':
      text = 'Не е получено в Офис'
      break
    case 'to_label': {
      const forStores = w.forStores.map(s => `${storeName(s.store_id)} ${s.qty}`).join(', ')
      text = <>Чака етикет в {warehouseName}{forStores && <span className="text-muted-foreground"> · за {forStores}</span>}</>
      href = labelHref
      break
    }
    case 'office':
      text = `В ${warehouseName}, с етикет`
      break
    case 'to_trip':
      text = <>Чака курс за <b>{store}</b></>
      href = '/deliveries/trips'
      break
    case 'on_trip':
      text = <>В курс за <b>{store}</b> <span className="text-muted-foreground">· {trip}, още не е тръгнал</span></>
      href = p.trip_id ? `/deliveries/trips/${p.trip_id}` : undefined
      break
    case 'on_way':
      text = <>На път към <b>{store}</b> <span className="text-muted-foreground">· {trip}</span></>
      href = p.trip_id ? `/deliveries/trips/${p.trip_id}` : undefined
      break
    case 'accepted':
      text = (
        <>Прието в <b>{store}</b> <span className="text-muted-foreground">· {trip}</span>
          {p.missing ? <span className="text-red-700"> · липсват {p.missing}</span> : null}</>
      )
      href = p.trip_id ? `/deliveries/trips/${p.trip_id}` : undefined
      break
  }
  const body = (
    <>
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', STAGE_TONE[p.stage].dot)} />
      <span className="min-w-0 flex-1">{text}</span>
      <span className="shrink-0 font-semibold tabular-nums">{p.qty} бр.</span>
      {href && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
    </>
  )
  return (
    <li>
      {href ? (
        <Link href={href} className="-mx-1.5 flex items-start gap-2 rounded px-1.5 py-0.5 text-sm hover:bg-slate-50">{body}</Link>
      ) : (
        <div className="flex items-start gap-2 py-0.5 text-sm">{body}</div>
      )}
    </li>
  )
}
