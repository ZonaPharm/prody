import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { isUuid } from '@/lib/deliveries/api'
import { countOpenProblems } from '@/lib/deliveries/work'
import { DeliveriesTabs } from '@/components/deliveries/deliveries-tabs'
import { OrderEditor } from '@/components/supplier-orders/order-editor'
import { OrderView } from '@/components/supplier-orders/order-view'
import { getOrderDetail, getSupplierContacts } from '@/lib/supplier-orders/queries'
import { getOrderSignature, orderDocFrom } from '@/lib/supplier-orders/doc'
import { mailNotReady } from '@/lib/supplier-orders/email'
import { orderText } from '@/lib/supplier-orders/format'

export const dynamic = 'force-dynamic'

/** A draft opens in the editor; a sent, arrived or cancelled order is shown with its next step. */
export default async function OrderPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sent?: string }>
}) {
  const user = await requireDeliveriesAdmin({ adminOnly: true })
  const { id } = await params
  const { sent } = await searchParams
  if (!isUuid(id)) notFound()

  const supabase = await createServerSupabaseClient()
  const admin = createAdminClient()
  const [order, signature, mail] = await Promise.all([
    getOrderDetail(supabase, id),
    getOrderSignature(admin),
    (admin.from('email_settings') as any).select('smtp_host, smtp_port, smtp_user, smtp_pass, sender_email').eq('id', 1).maybeSingle(),
  ])
  if (!order) notFound()
  const mailReady = mailNotReady(mail.data) === null

  if (order.status === 'draft') {
    const suppliers = await getSupplierContacts(supabase)
    return (
      <OrderEditor
        initial={{
          id: order.id,
          number: order.number,
          updated_at: order.updated_at,
          supplier_id: order.supplier.id,
          notes: order.notes ?? '',
          lines: order.lines.map(l => ({ product: l.product, quantity: l.quantity, note: l.note })),
        }}
        suppliers={suppliers}
        signature={signature}
        mailReady={mailReady}
        senderName={user.display_name}
      />
    )
  }

  const problems = await countOpenProblems(supabase)
  return (
    <div className="space-y-4">
      <DeliveriesTabs active="orders" problems={problems} />
      <OrderView
        order={order}
        text={orderText(orderDocFrom(order, signature, order.sender ?? user.display_name))}
        mailReady={mailReady}
        justSent={sent === 'email' || sent === 'manual' ? sent : null}
      />
    </div>
  )
}
