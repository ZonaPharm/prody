import { createAdminClient } from '@/lib/supabase/admin'
import { errorAlertHtml, errorAlertSubject, type AlertRow } from './alert-format'
import { rawConsoleError } from './server'

let lastAttempt = 0
const MIN_GAP_MS = 60_000

/**
 * E-mails the new errors to the addresses in Настройки → Грешки
 * (email_settings.error_alert_to), at most once an hour: claim_app_error_alert
 * hands out the waiting errors only if no e-mail went in the last hour, and
 * marks them as told. Errors that arrive within that hour wait for the next
 * error after it, or for the nightly job, whichever comes first.
 *
 * Nothing configured (no SMTP password, no recipients — staging has neither)
 * means nothing is claimed, so the errors are still waiting once it is set up.
 *
 * Never throws, and reports its own failures only to the original console, so
 * a broken mail server cannot cause more errors and more e-mails.
 */
export async function sendErrorAlert(options: { force?: boolean } = {}): Promise<void> {
  // The same instance does not knock on the database and the mail server more
  // than once a minute, e.g. while an error repeats or the mail server is down.
  const now = Date.now()
  if (!options.force && now - lastAttempt < MIN_GAP_MS) return
  lastAttempt = now
  try {
    const admin = createAdminClient()
    const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).maybeSingle()
    const to: string[] = Array.isArray(settings?.error_alert_to) ? settings.error_alert_to.filter((s: unknown) => typeof s === 'string' && s) : []
    if (!settings?.smtp_host || !settings?.smtp_pass || to.length === 0) return

    const { data: rows, error } = await (admin as any).rpc('claim_app_error_alert')
    if (error) { rawConsoleError('app_errors: alert claim failed:', JSON.stringify(error)); return }
    if (!Array.isArray(rows) || rows.length === 0) return

    try {
      const nodemailer = await import('nodemailer')
      const transport = nodemailer.default.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_port === 465,
        auth: { user: settings.smtp_user, pass: settings.smtp_pass },
      })
      await transport.sendMail({
        from: settings.sender_email || settings.smtp_user,
        to: to.join(', '),
        subject: errorAlertSubject(rows as AlertRow[]),
        html: errorAlertHtml(rows as AlertRow[], process.env.NEXT_PUBLIC_SITE_URL),
      })
    } catch (e) {
      // Not sent: give them back, so the next attempt tells about them.
      await (admin.from('app_errors') as any).update({ notified_at: null }).in('id', rows.map((r: any) => r.id))
      rawConsoleError('app_errors: alert e-mail failed:', e)
    }
  } catch (e) {
    rawConsoleError('app_errors: alert failed:', e)
  }
}
