import nodemailer from 'nodemailer'
import { companyName, orderHtml, orderSubject, orderText, type OrderDoc } from './format'

/**
 * Sends an order to the supplier through the SMTP of Настройки → Имейл (the same
 * Brevo account as the weekly report). The person who sends it gets a copy and
 * the supplier's answer (Reply-To), so the conversation stays with them.
 */

export type MailSettings = {
  smtp_host: string | null
  smtp_port: number | null
  smtp_user: string | null
  smtp_pass: string | null
  sender_email: string | null
}

/** Why the order cannot go by e-mail with these settings, or null when it can. */
export function mailNotReady(s: MailSettings | null | undefined): string | null {
  if (!s || !s.smtp_host || !s.smtp_user || !s.smtp_pass || !s.sender_email) {
    return 'Пощата на приложението не е настроена (Настройки → Имейл). Изпратете поръчката сами и натиснете „Поръчах я сам“.'
  }
  return null
}

export async function sendOrderEmail(
  settings: MailSettings,
  doc: OrderDoc,
  to: string[],
  sender: { email: string; name: string },
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: settings.smtp_host!,
    port: settings.smtp_port ?? 587,
    secure: settings.smtp_port === 465,
    auth: { user: settings.smtp_user!, pass: settings.smtp_pass! },
  })
  await transport.sendMail({
    from: { name: companyName(doc.signature), address: settings.sender_email! },
    to: to.join(', '),
    cc: sender.email,
    replyTo: { name: sender.name, address: sender.email },
    subject: orderSubject(doc),
    text: orderText(doc),
    html: orderHtml(doc),
  })
}
