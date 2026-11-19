/**
 * Orders to suppliers ("Поръчки"): how they read on screen, in the e-mail, on paper
 * and in the copied text, and how what came compares with what was ordered.
 * Pure functions only.
 */

export type OrderStatus = 'draft' | 'sent' | 'received' | 'cancelled'

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Чернова',
  sent: 'Изпратена',
  received: 'Пристигнала',
  cancelled: 'Отказана',
}

export const ORDER_STATUS_TONE: Record<OrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  sent: 'bg-amber-50 text-amber-800 border-amber-200',
  received: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status as OrderStatus] ?? status
}

/** ПР-000012: "Поръчка", so it does not mix with the stores' "Заявки". */
export function formatOrderNumber(number: number | null | undefined): string {
  return number == null ? '' : `ПР-${String(number).padStart(6, '0')}`
}

// ---------------------------------------------------------------------------
// Supplier e-mail addresses
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]{2,}$/

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim())
}

/**
 * The addresses typed in one field ("a@x.bg, b@x.bg" or one per line):
 * trimmed, lower-cased, without repeats. `bad` lists what is not an address.
 */
export function parseEmails(text: string): { emails: string[]; bad: string[] } {
  const parts = text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
  const emails: string[] = []
  const bad: string[] = []
  for (const p of parts) {
    if (!isEmail(p)) bad.push(p)
    else if (!emails.includes(p.toLowerCase())) emails.push(p.toLowerCase())
  }
  return { emails, bad }
}

// ---------------------------------------------------------------------------
// The order as the supplier sees it
// ---------------------------------------------------------------------------

export type OrderDocLine = {
  name: string
  /** The manufacturer's barcode; our own 200… codes mean nothing to the supplier. */
  barcode: string | null
  quantity: number
  note: string | null
  /** Units per column of OrderDoc.split, when the split goes to the supplier. */
  split?: number[]
}

/** The split per store shown to the supplier ("Прати разпределението"), to pack per store. */
export type OrderDocSplit = { columns: string[] }

export type OrderDoc = {
  number: number
  supplierName: string
  contactName: string | null
  notes: string | null
  lines: OrderDocLine[]
  /** Company, delivery address, phone: Настройки → Доставчици. */
  signature: string | null
  senderName: string
  /** Null (the default): the supplier sees products and quantities only. */
  split?: OrderDocSplit | null
}

/**
 * The split as the supplier sees it: one column per store that gets anything (in
 * the stores' order), then the warehouse for what is not split, when anything is
 * left for it. Null when nothing is split.
 */
export function splitForSupplier(
  lines: { quantity: number; plan: Record<string, number> }[],
  stores: { id: string; name: string; is_warehouse: boolean }[],
): { columns: string[]; rows: number[][] } | null {
  const shops = stores.filter(s => !s.is_warehouse && lines.some(l => (l.plan[s.id] ?? 0) > 0))
  if (shops.length === 0) return null
  const rest = lines.map(l => Math.max(0, l.quantity - shops.reduce((n, s) => n + (l.plan[s.id] ?? 0), 0)))
  const warehouse = stores.find(s => s.is_warehouse)?.name ?? 'Офис'
  const withRest = rest.some(r => r > 0)
  return {
    columns: [...shops.map(s => s.name), ...(withRest ? [warehouse] : [])],
    rows: lines.map((l, i) => [...shops.map(s => l.plan[s.id] ?? 0), ...(withRest ? [rest[i]] : [])]),
  }
}

/** A barcode worth showing to a supplier: digits, and not one of our in-store 200–299 codes. */
export function supplierBarcode(barcode: string | null | undefined): string | null {
  const b = (barcode ?? '').trim()
  if (!b) return null
  if (/^2\d{12}$/.test(b)) return null
  return b
}

/** The first line of the signature names the company; "Зона Фарма" until one is set. */
export function companyName(signature: string | null | undefined): string {
  const first = (signature ?? '').split('\n').map(s => s.trim()).find(Boolean)
  return first || 'Зона Фарма'
}

export function orderTotals(lines: { quantity: number }[]): { lines: number; units: number } {
  return { lines: lines.length, units: lines.reduce((n, l) => n + l.quantity, 0) }
}

function productsWord(n: number): string {
  return n === 1 ? 'продукт' : 'продукта'
}

export function orderSubject(doc: Pick<OrderDoc, 'number' | 'signature'>): string {
  return `Поръчка ${formatOrderNumber(doc.number)} от ${companyName(doc.signature)}`
}

function greeting(contact: string | null): string {
  return contact?.trim() ? `Здравейте, ${contact.trim()},` : 'Здравейте,'
}

/** Plain text: the e-mail's text part, and "Копирай текста" for Viber or a phone call. */
export function orderText(doc: OrderDoc): string {
  const t = orderTotals(doc.lines)
  const out: string[] = []
  out.push(greeting(doc.contactName))
  out.push('')
  out.push(`Моля, подгответе и изпратете поръчка ${formatOrderNumber(doc.number)}:`)
  out.push('')
  doc.lines.forEach((l, i) => {
    const code = l.barcode ? ` (${l.barcode})` : ''
    const note = l.note ? ` — ${l.note}` : ''
    out.push(`${i + 1}. ${l.name}${code} — ${l.quantity} бр.${note}`)
  })
  out.push('')
  out.push(`Общо: ${t.lines} ${productsWord(t.lines)}, ${t.units} бр.`)
  if (doc.split) {
    out.push('')
    out.push('Моля, опаковайте отделно за всеки обект:')
    doc.split.columns.forEach((col, c) => {
      const items = doc.lines
        .map(l => ({ name: l.name, qty: l.split?.[c] ?? 0 }))
        .filter(x => x.qty > 0)
      if (items.length === 0) return
      const units = items.reduce((n, x) => n + x.qty, 0)
      out.push('')
      out.push(`${col} (${units} бр.):`)
      for (const x of items) out.push(`- ${x.name} — ${x.qty} бр.`)
    })
  }
  if (doc.notes?.trim()) {
    out.push('')
    out.push(`Бележка: ${doc.notes.trim()}`)
  }
  out.push('')
  out.push('Ако нещо липсва или ще се забави, моля, пишете ни в отговор.')
  out.push('')
  out.push('Поздрави,')
  out.push(doc.senderName)
  if (doc.signature?.trim()) out.push(doc.signature.trim())
  return out.join('\n')
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function nl2br(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>')
}

/** The e-mail's HTML part: the same as orderText, with the lines as a table. */
export function orderHtml(doc: OrderDoc): string {
  const t = orderTotals(doc.lines)
  const anyCode = doc.lines.some(l => l.barcode)
  const anyNote = doc.lines.some(l => l.note)
  const td = 'style="padding:6px 10px;border:1px solid #cbd5e1"'
  const th = 'style="padding:6px 10px;border:1px solid #cbd5e1;background:#f1f5f9;text-align:left"'
  const cols = doc.split?.columns ?? []
  const rows = doc.lines
    .map((l, i) =>
      `<tr><td ${td}>${i + 1}</td><td ${td}>${escapeHtml(l.name)}</td>` +
      (anyCode ? `<td ${td}>${escapeHtml(l.barcode ?? '')}</td>` : '') +
      cols.map((_, c) => `<td ${td} align="right">${l.split?.[c] ? l.split[c] : ''}</td>`).join('') +
      `<td ${td} align="right"><strong>${l.quantity}</strong></td>` +
      (anyNote ? `<td ${td}>${escapeHtml(l.note ?? '')}</td>` : '') +
      `</tr>`,
    )
    .join('')
  const colTotals = cols.length
    ? `<tr><td ${td}></td><td ${td}><strong>Общо</strong></td>${anyCode ? `<td ${td}></td>` : ''}` +
      cols.map((_, c) => `<td ${td} align="right"><strong>${doc.lines.reduce((n, l) => n + (l.split?.[c] ?? 0), 0)}</strong></td>`).join('') +
      `<td ${td} align="right"><strong>${t.units}</strong></td>${anyNote ? `<td ${td}></td>` : ''}</tr>`
    : ''
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a">`,
    `<p>${escapeHtml(greeting(doc.contactName))}</p>`,
    `<p>Моля, подгответе и изпратете поръчка <strong>${formatOrderNumber(doc.number)}</strong>:</p>`,
    cols.length ? `<p>Моля, опаковайте отделно за всеки обект: колко бройки за кой обект е в колоните.</p>` : '',
    `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse">`,
    `<tr><th ${th}>№</th><th ${th}>Продукт</th>${anyCode ? `<th ${th}>Баркод</th>` : ''}` +
      cols.map(c => `<th ${th}>${escapeHtml(c)}</th>`).join('') +
      `<th ${th}>${cols.length ? 'Общо' : 'Брой'}</th>${anyNote ? `<th ${th}>Бележка</th>` : ''}</tr>`,
    rows,
    colTotals,
    `</table>`,
    `<p>Общо: ${t.lines} ${productsWord(t.lines)}, ${t.units} бр.</p>`,
    doc.notes?.trim() ? `<p><strong>Бележка:</strong> ${nl2br(doc.notes.trim())}</p>` : '',
    `<p>Ако нещо липсва или ще се забави, моля, пишете ни в отговор.</p>`,
    `<p>Поздрави,<br>${escapeHtml(doc.senderName)}${doc.signature?.trim() ? `<br>${nl2br(doc.signature.trim())}` : ''}</p>`,
    `</div>`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// What came against what was ordered (the draft delivery made from an order)
// ---------------------------------------------------------------------------

export type OrderedLine = { product_id: string; name: string; quantity: number }

export type OrderDiff = {
  /** Ordered, not on the delivery. */
  missing: OrderedLine[]
  /** On the delivery, not ordered. */
  extra: { product_id: string; name: string; quantity: number }[]
  /** On both with another quantity. */
  changed: { product_id: string; name: string; ordered: number; came: number }[]
  same: boolean
}

/**
 * The delivery may carry a product on more than one line (other boxes or
 * invoices): its quantities are added up before comparing.
 */
export function compareWithOrder(
  ordered: OrderedLine[],
  delivered: { product_id: string; name: string; quantity: number }[],
): OrderDiff {
  const came = new Map<string, { name: string; quantity: number }>()
  for (const d of delivered) {
    const cur = came.get(d.product_id)
    came.set(d.product_id, { name: d.name, quantity: (cur?.quantity ?? 0) + (d.quantity || 0) })
  }
  const orderedIds = new Set(ordered.map(o => o.product_id))
  const missing: OrderedLine[] = []
  const changed: OrderDiff['changed'] = []
  for (const o of ordered) {
    const c = came.get(o.product_id)
    if (!c) missing.push(o)
    else if (c.quantity !== o.quantity) changed.push({ product_id: o.product_id, name: o.name, ordered: o.quantity, came: c.quantity })
  }
  const extra = [...came.entries()]
    .filter(([id]) => !orderedIds.has(id))
    .map(([product_id, c]) => ({ product_id, name: c.name, quantity: c.quantity }))
  return { missing, extra, changed, same: missing.length === 0 && extra.length === 0 && changed.length === 0 }
}

/** One sentence for the top of the delivery: "2 продукта не са дошли, 1 е дошъл извън поръчката". */
export function diffSentence(diff: OrderDiff): string {
  if (diff.same) return 'Всичко е като в поръчката.'
  const parts: string[] = []
  if (diff.missing.length) parts.push(`${diff.missing.length} ${diff.missing.length === 1 ? 'продукт не е дошъл' : 'продукта не са дошли'}`)
  if (diff.changed.length) parts.push(`${diff.changed.length} ${diff.changed.length === 1 ? 'е с друго количество' : 'са с друго количество'}`)
  if (diff.extra.length) parts.push(`${diff.extra.length} ${diff.extra.length === 1 ? 'е дошъл извън поръчката' : 'са дошли извън поръчката'}`)
  const s = parts.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}
