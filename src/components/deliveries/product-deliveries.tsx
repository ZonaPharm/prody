import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ProductDeliveryLine } from '@/lib/deliveries/queries'
import { whereabouts } from '@/lib/deliveries/track'
import { formatDeliveryNumber } from '@/lib/deliveries/format'
import { sofiaDate } from '@/lib/date-utils'
import { DeliveryStatusBadge } from './status-badge'
import { WhereIsIt } from './where-is-it'

type Names = { storeName: (id: string) => string; warehouseName: string }

/** Number and status, then date, quantity, supplier and invoice; on two lines when `stacked`. */
function Meta({ l, stacked }: { l: ProductDeliveryLine; stacked?: boolean }) {
  const rest = (
    <span className="text-muted-foreground">
      {sofiaDate(l.created_at)} · <b className="font-semibold text-foreground">{l.quantity} бр.</b>
      {l.supplier_name ? ` · ${l.supplier_name}` : ''}{l.doc_number ? ` · Ф-ра ${l.doc_number}` : ''}
    </span>
  )
  return (
    <div className={stacked ? 'space-y-0.5 text-sm' : 'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'}>
      <div className="flex items-center gap-2">
        <Link href={`/deliveries/${l.delivery_id}`} className="font-semibold hover:underline">{formatDeliveryNumber(l.delivery_number)}</Link>
        <DeliveryStatusBadge status={l.delivery_status} />
      </div>
      {stacked ? <p>{rest}</p> : rest}
    </div>
  )
}

/**
 * The latest delivery of the product, in full: where every unit of it is now. The
 * older ones are in the "Доставки" tab under the stock, so the page stays short
 * however many deliveries the product had.
 */
export function LatestDelivery({ line, total, allHref, storeName, warehouseName }: Names & {
  line: ProductDeliveryLine
  total: number
  allHref: string
}) {
  return (
    <div className="space-y-3">
      <Meta l={line} />
      <WhereIsIt
        w={whereabouts(line, line.ship_lines)}
        storeName={storeName}
        warehouseName={warehouseName}
        labelHref={`/deliveries/labels?delivery=${line.delivery_id}`}
        oneColumn
      />
      {total > 1 && (
        <Link href={allHref} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Всички доставки на продукта ({total}{total >= 50 ? '+' : ''})
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  )
}

/**
 * Every delivery of the product, one short row each: the bar and one sentence on
 * where it is. "Подробно" opens the rows per stage and store.
 */
export function DeliveriesList({ lines, storeName, warehouseName }: Names & { lines: ProductDeliveryLine[] }) {
  if (lines.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Продуктът още не е бил в доставка.</p>
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border">
        {lines.map(l => {
          const w = whereabouts(l, l.ship_lines)
          return (
            <li key={l.item_id} className="grid gap-2 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-6">
              <Meta l={l} stacked />
              {w.parts.some(p => p.store_id) ? (
                <details className="group">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <WhereIsIt w={w} storeName={storeName} warehouseName={warehouseName} compact />
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                      <span className="group-open:hidden">Покажи по магазини</span>
                      <span className="hidden group-open:inline">Скрий</span>
                    </span>
                  </summary>
                  <div className="pt-2">
                    <WhereIsIt
                      w={w}
                      storeName={storeName}
                      warehouseName={warehouseName}
                      labelHref={`/deliveries/labels?delivery=${l.delivery_id}`}
                      oneColumn
                      rowsOnly
                    />
                  </div>
                </details>
              ) : (
                <WhereIsIt w={w} storeName={storeName} warehouseName={warehouseName} compact />
              )}
            </li>
          )
        })}
      </ul>
      {lines.length >= 50 && <p className="text-xs text-muted-foreground">Показани са последните 50 доставки.</p>}
    </div>
  )
}
