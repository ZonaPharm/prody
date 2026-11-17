import { sofiaDateTime } from '@/lib/date-utils'

/** The fields of an app_errors row the e-mail needs. */
export interface AlertRow {
  source: 'server' | 'browser'
  kind: string
  message: string
  path: string | null
  user_name: string | null
  count: number
  first_seen: string
  last_seen: string
}

const MAX_LISTED = 20

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function short(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function errorAlertSubject(rows: AlertRow[]): string {
  return rows.length === 1 ? 'Prody: нова грешка' : `Prody: ${rows.length} нови грешки`
}

/** Plain, short, readable on a phone: what, where, how often, and a link to the screen. */
export function errorAlertHtml(rows: AlertRow[], siteUrl: string | undefined): string {
  const link = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/settings?tab=errors` : null
  const items = rows.slice(0, MAX_LISTED).map(r => {
    const where = [
      r.source === 'browser' ? 'В браузъра' : 'На сървъра',
      r.path ? esc(r.path) : null,
      r.user_name ? esc(r.user_name) : null,
    ].filter(Boolean).join(' · ')
    const times = r.count > 1 ? `${r.count} пъти, последно ${sofiaDateTime(r.last_seen)}` : sofiaDateTime(r.first_seen)
    return `<li style="margin-bottom:12px">
  <div style="font-family:monospace;font-size:13px;color:#991b1b">${esc(short(r.message, 300))}</div>
  <div style="font-size:12px;color:#64748b">${where} · ${times}</div>
</li>`
  }).join('\n')
  const more = rows.length > MAX_LISTED ? `<p style="color:#64748b">… и още ${rows.length - MAX_LISTED}.</p>` : ''
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0f172a">
<p>В Prody има ${rows.length === 1 ? 'нова грешка' : `${rows.length} нови грешки`}:</p>
<ul style="padding-left:18px">
${items}
</ul>
${more}
${link ? `<p><a href="${esc(link)}">Отвори Настройки → Грешки</a></p>` : ''}
<p style="font-size:12px;color:#64748b">Следващ имейл идва най-рано след час, със събраните дотогава нови грешки. Ако грешка се появи пак, след като е маркирана „Оправено“, пак ще дойде имейл.</p>
</div>`
}
