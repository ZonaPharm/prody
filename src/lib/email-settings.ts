import { z } from 'zod'

/**
 * Настройки → Имейл. The SMTP password is a secret: it is written from the
 * settings screen but never sent back to a browser, not even an admin's.
 * The screen only learns whether one is saved (smtp_pass_set).
 */

/** The fields the settings screen may change. Anything else in the body is ignored. */
export const emailSettingsSchema = z.object({
  smtp_host: z.string().trim().max(255).nullish(),
  smtp_port: z.coerce.number().int().min(1).max(65535).nullish(),
  smtp_user: z.string().trim().max(255).nullish(),
  /** Empty or missing keeps the saved password. */
  smtp_pass: z.string().max(500).nullish(),
  sender_email: z.string().trim().max(255).nullish(),
  recipients: z.array(z.string().trim().max(255).regex(/^[^\s@]+@[^\s@]+$/)).max(50).nullish(),
  report_day: z.coerce.number().int().min(0).max(6).nullish(),
  report_hour: z.coerce.number().int().min(0).max(23).nullish(),
  report_minute: z.coerce.number().int().min(0).max(59).nullish(),
  report_sections: z.array(z.string().max(50)).max(20).nullish(),
})

export type EmailSettingsInput = z.infer<typeof emailSettingsSchema>

/** The row as the settings screen sees it: everything but the password. */
export function publicEmailSettings(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return { smtp_pass_set: false }
  const { smtp_pass, ...rest } = row
  return { ...rest, smtp_pass_set: typeof smtp_pass === 'string' && smtp_pass.length > 0 }
}

/** What to write: only the known fields that were sent, the password only when a new one was typed. */
export function emailSettingsUpdate(input: EmailSettingsInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === 'smtp_pass') {
      if (typeof value === 'string' && value.length > 0) out.smtp_pass = value
      continue
    }
    out[key] = value
  }
  return out
}
