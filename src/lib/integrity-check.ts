import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/fetch-all'
import { isMissingTableError } from '@/lib/missing-table'
import {
  evaluateIntegrity,
  integritySummaryHtml,
  type DeliveriesInput,
  type IntegrityInput,
  type IntegrityReport,
} from '@/lib/integrity-rules'

/**
 * Reads what the integrity rules need and evaluates them.
 *
 * Never throws. A check that cannot run comes back as an error finding, so the
 * nightly job reports it rather than crashing — and the backup that runs
 * alongside it is never held up by a check.
 */
export async function runIntegrityCheck(): Promise<IntegrityReport> {
  try {
    const admin = createAdminClient()

    const now = Date.now()
    // A sale's stock movement is written moments after the sale. Skip the last
    // ten minutes so one in flight is not reported as missing.
    const salesTo = new Date(now - 10 * 60 * 1000).toISOString()
    const salesFrom = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    // Movements over a slightly wider window, so a sale at the edge still
    // finds its movement.
    const movementsFrom = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString()

    const [products, batches, recentSales, movements, deliveries] = await Promise.all([
      fetchAll<any>(() => (admin.from('products') as any)
        .select('id, name, status, quantity_on_hand').order('id')),
      fetchAll<any>(() => (admin.from('stock_batches') as any)
        .select('product_id, store_id, quantity_remaining').order('id')),
      fetchAll<any>(() => (admin.from('sales') as any)
        .select('id').gte('created_at', salesFrom).lte('created_at', salesTo).order('id')),
      fetchAll<any>(() => (admin.from('stock_movements') as any)
        .select('sale_id').not('sale_id', 'is', null).gte('created_at', movementsFrom).order('id')),
      loadDeliveries(admin, now),
    ])

    return evaluateIntegrity({
      products,
      batches,
      recentSales,
      movementSaleIds: movements.map((m: any) => m.sale_id),
      deliveries,
    })
  } catch (err: any) {
    return {
      ok: false,
      findings: [{
        check: 'run',
        severity: 'error',
        title: 'Проверката на данните не можа да се изпълни',
        detail: [err?.message || 'неизвестна грешка'],
      }],
      stats: { products: 0, batches: 0, salesChecked: 0 },
    }
  }
}

/**
 * The deliveries tables, read on their own: if they cannot be read — most
 * likely because the migration is not applied yet where this runs — the
 * delivery checks are skipped with a finding and every other check still runs.
 */
async function loadDeliveries(
  admin: ReturnType<typeof createAdminClient>,
  now: number,
): Promise<IntegrityInput['deliveries']> {
  type Data = DeliveriesInput
  // src/types/supabase.ts predates these tables, so the client is untyped here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = (table: string) => (admin.from as (t: string) => any)(table)
  try {
    const [stores, deliveries, items, plans, sentShipments] = await Promise.all([
      fetchAll<Data['stores'][number]>(() => from('stores')
        .select('id, name, is_warehouse').order('id')),
      fetchAll<Data['deliveries'][number]>(() => from('deliveries')
        .select('id, number, status').order('id')),
      fetchAll<Data['items'][number]>(() => from('delivery_items')
        .select('id, delivery_id, product_id, received_qty').order('id')),
      fetchAll<Data['plans'][number]>(() => from('delivery_item_plan')
        .select('id, delivery_item_id, store_id, planned_qty, ready_qty, shipped_qty').order('id')),
      fetchAll<Data['sentShipments'][number]>(() => from('shipments')
        .select('id, number, store_id, sent_at').eq('status', 'sent').order('id')),
    ])
    return { stores, deliveries, items, plans, sentShipments, now }
  } catch (err) {
    return {
      unavailable: (err as { message?: string } | null)?.message || 'неизвестна грешка',
      missingTables: isMissingTableError(err),
    }
  }
}

export { integritySummaryHtml }

/**
 * A separate, unmissable email when the check finds an error. Warnings ride in
 * the daily backup email only: an alert every night for something already
 * known teaches people to stop reading alerts.
 *
 * Never throws.
 */
export async function sendIntegrityAlert(report: IntegrityReport): Promise<void> {
  if (report.ok) return

  try {
    const admin = createAdminClient()
    const { data: settings } = await (admin.from('email_settings') as any)
      .select('*').limit(1).single()
    if (!settings) return

    const { data: admins } = await (admin.from('users') as any)
      .select('email').eq('role', 'admin')
    const recipients = (admins || []).map((u: any) => u.email).filter(Boolean)
    if (recipients.length === 0) return

    const nodemailer = await import('nodemailer')
    const transport = nodemailer.default.createTransport({
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: settings.smtp_port === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    })

    const errors = report.findings.filter(f => f.severity === 'error').length
    await transport.sendMail({
      from: settings.sender_email,
      to: recipients.join(', '),
      subject: `[Prody] ❌ Проверката на данните откри ${errors} ${errors === 1 ? 'проблем' : 'проблема'}`,
      html: `${integritySummaryHtml(report)}
<p>Нищо не е променено автоматично. Проверката само чете.</p>`,
    })
  } catch (err: any) {
    console.error('Integrity alert could not be sent:', err?.message)
  }
}
