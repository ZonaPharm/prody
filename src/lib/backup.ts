import { createAdminClient } from '@/lib/supabase/admin'
import { gzipSync } from 'zlib'
import { fetchAll } from '@/lib/fetch-all'

const TABLES = [
  'products',
  'product_images',
  'categories',
  'labels',
  'stores',
  'stock_batches',
  'stock_movements',
  'stock_requests',
  'request_events',
  'sales',
  'users',
  'email_settings',
  'audit_logs',
]

const BUCKET = 'db-backups'
const RETENTION_DAYS = 7

export interface BackupResult {
  status: 'ok' | 'partial' | 'error'
  filename?: string
  size?: number
  tables?: number
  rows?: number
  details?: string
  email?: string
  error?: string
}

/**
 * @param extraHtml Appended to the success email — the nightly data check puts
 *   its summary here, so the one email that arrives every morning also says
 *   whether the data is consistent.
 */
export async function runBackup(extraHtml = ''): Promise<BackupResult> {
  const admin = createAdminClient()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backup: Record<string, any[]> = {}
  let emailResult = 'not sent'

  const failedTables: string[] = []

  try {
    // 1. Export all tables.
    //
    // Paged, not a plain select: PostgREST caps a response at 1000 rows and
    // truncates silently. Every backup taken before this change holds only the
    // first 1000 rows of each table — with 5314 sales and 2405 batches, most of
    // the data was never in the file, and its size looked plausible anyway.
    for (const table of TABLES) {
      try {
        backup[table] = await fetchAll<any>(() => (admin.from(table) as any).select('*'))
      } catch (tableErr: any) {
        // A table that cannot be read is a hole in the backup, not a detail to
        // log and walk past: the file would still be written and reported as a
        // success while missing whatever that table held.
        console.error(`Backup: error reading ${table}:`, tableErr?.message)
        failedTables.push(table)
      }
    }

    if (failedTables.length > 0) {
      return {
        status: 'partial',
        error: `Таблици, които не бяха прочетени: ${failedTables.join(', ')}`,
      }
    }

    const rowCounts = Object.entries(backup).map(([t, rows]) => `${t}:${rows.length}`).join(',')
    const totalRows = Object.values(backup).reduce((sum, rows) => sum + rows.length, 0)

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      row_counts: Object.fromEntries(Object.entries(backup).map(([t, r]) => [t, r.length])),
      data: backup,
    })

    const gzipped = gzipSync(payload)
    const filename = `prody-backup-${timestamp}.json.gz`

    // 2. Upload to Supabase Storage
    const { error: uploadError } = await (admin.storage.from(BUCKET) as any).upload(filename, gzipped, {
      contentType: 'application/gzip',
      upsert: false,
    })

    if (uploadError) {
      console.error('Backup: upload error:', uploadError.message)
      return {
        status: 'partial',
        error: `Upload failed: ${uploadError.message}`,
        tables: Object.keys(backup).length,
        rows: totalRows,
      }
    }

    // 3. Cleanup old backups
    const { data: files } = await (admin.storage.from(BUCKET) as any).list()
    const cutoff = Date.now() - RETENTION_DAYS * 86400000
    if (files) {
      for (const file of files) {
        const fileDate = file.name.match(/prody-backup-(\d{4}-\d{2}-\d{2})/)?.[1]
        if (fileDate && new Date(fileDate).getTime() < cutoff) {
          await (admin.storage.from(BUCKET) as any).remove([file.name])
        }
      }
    }

    // 4. Email backup to admin users only
    try {
      const { data: settings } = await (admin.from('email_settings') as any)
        .select('*').limit(1).single()

      if (settings) {
        const { data: admins } = await (admin.from('users') as any)
          .select('email').eq('role', 'admin')
        const adminEmails = (admins || []).map((u: any) => u.email).filter(Boolean)

        if (adminEmails.length > 0) {
          const nodemailer = await import('nodemailer')
          const transport = nodemailer.default.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port,
            secure: settings.smtp_port === 465,
            auth: { user: settings.smtp_user, pass: settings.smtp_pass },
          })

          const sizeKB = (gzipped.length / 1024).toFixed(1)

          // Paging made the backup complete, and therefore much larger — about
          // 1 MB gzipped today against 0.3 MB when it held only the first 1000
          // rows of each table. Attach it while it is small enough to arrive;
          // past the limit the mail would bounce and the backup would look
          // failed when the file is safely in storage. The copy in the bucket
          // is the real backup either way.
          const attachable = gzipped.length <= 8 * 1024 * 1024

          await transport.sendMail({
            from: settings.sender_email,
            to: adminEmails.join(', '),
            subject: `[Prody Backup] ${timestamp}`,
            html: `<p>Бекъп на базата данни — ${new Date().toLocaleDateString('bg-BG')}</p>
<p>Редове: ${totalRows} | Таблици: ${Object.keys(backup).length}</p>
<p>Размер: ${sizeKB} KB</p>
<p>Детайли: ${rowCounts}</p>
${attachable ? '' : '<p>Файлът е твърде голям за прикачване — изтеглете го от Настройки → Бекъпи.</p>'}
${extraHtml}`,
            ...(attachable ? {
              attachments: [{
                filename,
                content: gzipped,
                contentType: 'application/gzip',
              }],
            } : {}),
          })
          emailResult = attachable
            ? `sent to ${adminEmails.join(', ')}`
            : `sent to ${adminEmails.join(', ')} (without attachment, ${sizeKB} KB)`
        }
      }
    } catch (emailErr: any) {
      console.error('Backup: email error:', emailErr.message)
      emailResult = `failed: ${emailErr.message}`
    }

    return {
      status: 'ok',
      filename,
      size: gzipped.length,
      tables: Object.keys(backup).length,
      rows: totalRows,
      details: rowCounts,
      email: emailResult,
    }
  } catch (err: any) {
    console.error('Backup: fatal error:', err.message)
    return { status: 'error', error: err.message }
  }
}
