import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gzipSync } from 'zlib'
import nodemailer from 'nodemailer'

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

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backup: Record<string, any[]> = {}

  try {
    // 1. Export all tables
    for (const table of TABLES) {
      const { data, error } = await (admin.from(table) as any).select('*')
      if (error) {
        console.error(`Backup: error reading ${table}:`, error.message)
        continue
      }
      backup[table] = data || []
    }

    const rowCounts = Object.entries(backup).map(([t, rows]) => `${t}:${rows.length}`).join(',')
    const totalRows = Object.values(backup).reduce((sum, rows) => sum + rows.length, 0)

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      tables: Object.keys(backup),
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
      return NextResponse.json({
        status: 'partial',
        error: `Upload failed: ${uploadError.message}`,
        tables: Object.keys(backup).length,
        rows: totalRows,
      }, { status: 500 })
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

    // 4. Email backup
    try {
      const { data: settings } = await (admin.from('email_settings') as any)
        .select('*').limit(1).single()

      if (settings) {
        const transport = nodemailer.createTransport({
          host: settings.smtp_host,
          port: settings.smtp_port,
          secure: settings.smtp_port === 465,
          auth: { user: settings.smtp_user, pass: settings.smtp_pass },
        })

        const sizeKB = (gzipped.length / 1024).toFixed(1)
        await transport.sendMail({
          from: settings.sender_email,
          to: settings.recipients.join(', '),
          subject: `[Prody Backup] ${timestamp}`,
          html: `<p>Бекъп на базата данни — ${new Date().toLocaleDateString('bg-BG')}</p>
<p>Редове: ${totalRows} | Таблици: ${Object.keys(backup).length}</p>
<p>Размер: ${sizeKB} KB</p>
<p>Детайли: ${rowCounts}</p>`,
          attachments: [{
            filename,
            content: gzipped,
            contentType: 'application/gzip',
          }],
        })
      }
    } catch (emailErr: any) {
      console.error('Backup: email error:', emailErr.message)
    }

    return NextResponse.json({
      status: 'ok',
      filename,
      size: gzipped.length,
      tables: Object.keys(backup).length,
      rows: totalRows,
      details: rowCounts,
    })
  } catch (err: any) {
    console.error('Backup: fatal error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
