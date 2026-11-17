import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { getOrderDetail } from '@/lib/supplier-orders/queries'
import { getOrderSignature, orderDocFrom } from '@/lib/supplier-orders/doc'
import { companyName, formatOrderNumber, orderTotals } from '@/lib/supplier-orders/format'
import { sofiaDate } from '@/lib/date-utils'
import { PrintButton } from '@/components/deliveries/print-button'

export const dynamic = 'force-dynamic'

/** The order on paper (or PDF from the print dialog), for suppliers without e-mail. */
export default async function OrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDeliveriesAdmin({ adminOnly: true })
  const { id } = await params
  if (!isUuid(id)) notFound()
  const supabase = await createServerSupabaseClient()
  const order = await getOrderDetail(supabase, id)
  if (!order) notFound()
  const signature = await getOrderSignature(createAdminClient())
  const doc = orderDocFrom(order, signature, order.sender ?? user.display_name)
  const t = orderTotals(doc.lines)
  const anyCode = doc.lines.some(l => l.barcode)
  const anyNote = doc.lines.some(l => l.note)

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <span className="text-muted-foreground">Поръчка {formatOrderNumber(order.number)}</span>
        <PrintButton />
      </div>
      <div className="flex items-baseline justify-between border-b-2 border-black pb-1">
        <h1 className="text-xl font-bold">Поръчка {formatOrderNumber(order.number)}</h1>
        <span>{sofiaDate(order.sent_at ?? new Date())}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-slate-500">До</div>
          <div className="font-semibold">{order.supplier.name}</div>
          {order.supplier.contact_name && <div>{order.supplier.contact_name}</div>}
          {order.supplier.phone && <div>{order.supplier.phone}</div>}
        </div>
        <div>
          <div className="text-xs uppercase text-slate-500">От</div>
          <div className="whitespace-pre-line font-semibold">{signature?.trim() || companyName(null)}</div>
          <div>{doc.senderName}</div>
        </div>
      </div>
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="w-8 py-1">№</th>
            <th className="py-1">Продукт</th>
            {anyCode && <th className="py-1">Баркод</th>}
            <th className="py-1 text-right">Брой</th>
            {anyNote && <th className="py-1 pl-3">Бележка</th>}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-300 align-top">
              <td className="py-1">{i + 1}</td>
              <td className="py-1">{l.name}</td>
              {anyCode && <td className="py-1 font-mono text-xs">{l.barcode ?? ''}</td>}
              <td className="py-1 text-right font-semibold tabular-nums">{l.quantity}</td>
              {anyNote && <td className="py-1 pl-3">{l.note ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2">Общо: {t.lines} {t.lines === 1 ? 'продукт' : 'продукта'}, {t.units} бр.</p>
      {doc.notes && <p className="mt-2"><span className="font-semibold">Бележка:</span> {doc.notes}</p>}
    </div>
  )
}
