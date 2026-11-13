import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireDeliveriesAdmin } from '@/lib/deliveries/page-gate'
import { OrderEditor } from '@/components/supplier-orders/order-editor'
import { getSupplierContacts } from '@/lib/supplier-orders/queries'
import { getOrderSignature } from '@/lib/supplier-orders/doc'
import { mailNotReady } from '@/lib/supplier-orders/email'

export const dynamic = 'force-dynamic'

/** A new order has no row until it is saved (moving to step 3). ?supplier= starts at step 2. */
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const user = await requireDeliveriesAdmin({ adminOnly: true })
  const { supplier } = await searchParams
  const supabase = await createServerSupabaseClient()
  const admin = createAdminClient()
  const [suppliers, signature, mail] = await Promise.all([
    getSupplierContacts(supabase),
    getOrderSignature(admin),
    (admin.from('email_settings') as any).select('smtp_host, smtp_port, smtp_user, smtp_pass, sender_email').eq('id', 1).maybeSingle(),
  ])
  return (
    <OrderEditor
      initial={null}
      suppliers={suppliers}
      presetSupplierId={supplier ?? null}
      signature={signature}
      mailReady={mailNotReady(mail.data) === null}
      senderName={user.display_name}
    />
  )
}
