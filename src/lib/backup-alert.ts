import { createAdminClient } from '@/lib/supabase/admin'
import type { BackupResult } from '@/lib/backup'

/**
 * Tells the admins a backup did not work.
 *
 * The nightly backup failed every night from 12 May 2026 and nobody found out
 * until someone went looking in September. The backup succeeding was worth an
 * email; the backup failing was worth nothing. This corrects that.
 *
 * Never throws: an alert that cannot be sent must not turn a partial backup
 * into a crashed request, and the caller has already done the real work.
 */
export async function reportBackupFailure(result: BackupResult): Promise<void> {
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

    const when = new Date().toLocaleString('bg-BG')
    const what = result.status === 'partial'
      ? 'Бекъпът мина частично'
      : 'Бекъпът не мина'

    await transport.sendMail({
      from: settings.sender_email,
      to: recipients.join(', '),
      subject: `[Prody] ⚠️ ${what}`,
      html: `<p><strong>${what}</strong> — ${when}</p>
<p>Причина: ${result.error || 'неизвестна'}</p>
${result.details ? `<p>Детайли: ${result.details}</p>` : ''}
<p>Базата данни не е архивирана. Проверете настройките и пуснете бекъп ръчно от Настройки.</p>`,
    })
  } catch (err: any) {
    // Nowhere left to report to. The log is the last resort.
    console.error('Backup alert could not be sent:', err?.message)
  }
}
