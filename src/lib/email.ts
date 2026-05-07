import nodemailer from 'nodemailer'
import { buildExportWorkbook } from '@/lib/export-reports'

interface EmailSettings {
  smtp_host: string
  smtp_port: number
  smtp_user: string
  smtp_pass: string
  sender_email: string
  recipients: string[]
  report_day: number
  report_hour: number
  report_minute: number
  report_sections: string[]
}

function createTransport(settings: EmailSettings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_port === 465,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  })
}

function buildHtml(data: any, sections: string[]): string {
  const parts: string[] = []
  parts.push(`<h2>Седмичен отчет — Prody</h2>`)
  parts.push(`<p>Период: ${new Date(Date.now() - 7 * 86400000).toLocaleDateString('bg-BG')} — ${new Date().toLocaleDateString('bg-BG')}</p>`)

  if (sections.includes('summary')) {
    parts.push(`<h3>Общо</h3>`)
    parts.push(`<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">`)
    parts.push(`<tr><td><strong>Оборот</strong></td><td>${data.totalRevenue?.toFixed(0) || 0} €</td></tr>`)
    parts.push(`<tr><td><strong>Брой продажби</strong></td><td>${data.totalCount || 0}</td></tr>`)
    parts.push(`<tr><td><strong>Уникални продукти</strong></td><td>${data.uniqueProducts || 0}</td></tr>`)
    parts.push(`<tr><td><strong>Среден чек</strong></td><td>${data.totalCount > 0 ? (data.totalRevenue / data.totalCount).toFixed(0) : '0'} €</td></tr>`)
    parts.push(`</table>`)
  }

  if (sections.includes('stores') && data.storeBreakdown) {
    parts.push(`<h3>По обекти</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><th>Обект</th><th>Брой</th><th>Оборот</th></tr>`)
    data.storeBreakdown.forEach((s: any) => parts.push(`<tr><td>${s.store}</td><td>${s.count}</td><td>${s.revenue.toFixed(0)} €</td></tr>`))
    parts.push(`</table>`)
  }

  if (sections.includes('top-products') && data.topProducts) {
    parts.push(`<h3>Топ продукти (брой)</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><th>Продукт</th><th>Брой</th></tr>`)
    data.topProducts.slice(0, 5).forEach((p: any) => parts.push(`<tr><td>${p.name}</td><td>${p.quantity}</td></tr>`))
    parts.push(`</table>`)
  }

  if (sections.includes('low-stock') && data.lowStock) {
    parts.push(`<h3>Ниски наличности</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><th>Продукт</th><th>Наличност</th></tr>`)
    data.lowStock.forEach((p: any) => parts.push(`<tr><td>${p.name}</td><td style="color:${p.quantity_on_hand === 0 ? 'red' : 'orange'}">${p.quantity_on_hand} бр.</td></tr>`))
    parts.push(`</table>`)
  }

  return parts.join('\n')
}

export async function sendWeeklyReport(
  settings: EmailSettings,
  reportData: any,
  fetchSalesForExport: (query: { from: string; to: string; store_id?: string | null }) => Promise<any[]>
) {
  const transport = createTransport(settings)
  const html = buildHtml(reportData, settings.report_sections || ['summary'])

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]
  const excelBuffer = await buildExportWorkbook(
    { type: 'detail', from: weekAgo, to: today },
    fetchSalesForExport
  )

  await transport.sendMail({
    from: settings.sender_email,
    to: settings.recipients.join(', '),
    subject: `Седмичен отчет Prody — ${weekAgo} / ${today}`,
    html,
    attachments: [{
      filename: `sedmichen-otchet-${weekAgo}-${today}.xlsx`,
      content: excelBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  })
}
