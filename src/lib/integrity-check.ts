import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll } from '@/lib/fetch-all'
import { evaluateIntegrity, integritySummaryHtml, type IntegrityReport } from '@/lib/integrity-rules'

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

    const [products, batches, stores, recentSales, movements] = await Promise.all([
      fetchAll<any>(() => (admin.from('products') as any)
        .select('id, name, status, quantity_on_hand').order('id')),
      fetchAll<any>(() => (admin.from('stock_batches') as any)
        .select('product_id, store_id, quantity_remaining').order('id')),
      fetchAll<any>(() => (admin.from('stores') as any)
        .select('id, name').order('id')),
      fetchAll<any>(() => (admin.from('sales') as any)
        .select('id').gte('created_at', salesFrom).lte('created_at', salesTo).order('id')),
      fetchAll<any>(() => (admin.from('stock_movements') as any)
        .select('sale_id').not('sale_id', 'is', null).gte('created_at', movementsFrom).order('id')),
    ])

    return evaluateIntegrity({
      products,
      batches,
      stores,
      recentSales,
      movementSaleIds: movements.map((m: any) => m.sale_id),
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
