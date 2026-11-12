import type { LabelKind } from '@/lib/label-kind'

/**
 * The entry screen's state and how it becomes the body of an autosave.
 * Numbers are kept as the typed text until a save, so a half-typed "12," is
 * not lost or reformatted under the cursor.
 */

export type DraftLineState = {
  key: string
  id: string | null
  product: {
    id: string
    name: string
    sku: string | null
    image: string | null
    status: string
    price: number | null
  }
  supplier_id: string | null
  doc_number: string
  quantity: string
  pack_size: string
  unit_cost: string
  needs_label: boolean
  /** "Етикет" of the product: Пълен етикет / Само цена / Готов. */
  label_kind: LabelKind
  /** Set when the person changed "Етикет" on this screen; only then is it written to the product. */
  label_changed?: boolean
  plan: Record<string, string>
}

export type DraftHeaderState = { order_ref: string; notes: string }

export function parseQty(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  return parseInt(t, 10)
}

/** "5,40" and "5.40" both read as 5.4; anything else is not a price. */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null
  return Number(t)
}

/** What keeps a line from being saved, in words; null when it is complete. */
export function lineProblem(line: DraftLineState): string | null {
  const qty = parseQty(line.quantity)
  if (qty == null || qty < 1) return 'количество'
  const pack = line.pack_size.trim() === '' ? 1 : parseQty(line.pack_size)
  if (pack == null || pack < 1) return 'бройки в кутия'
  if (parseMoney(line.unit_cost) == null) return 'доставна цена'
  for (const v of Object.values(line.plan)) {
    if (v.trim() !== '' && parseQty(v) == null) return 'разпределение'
  }
  return null
}

export function planOf(line: DraftLineState): { store_id: string; planned_qty: number }[] {
  return Object.entries(line.plan)
    .map(([store_id, v]) => ({ store_id, planned_qty: parseQty(v) ?? 0 }))
    .filter(r => r.planned_qty > 0)
}

export function linePlanned(line: DraftLineState): number {
  return planOf(line).reduce((s, r) => s + r.planned_qty, 0)
}

export function lineOverPlanned(line: DraftLineState): number {
  return Math.max(0, linePlanned(line) - (parseQty(line.quantity) ?? 0))
}

export function toDraftPayload(header: DraftHeaderState, lines: DraftLineState[]) {
  return {
    order_ref: header.order_ref.trim() || null,
    notes: header.notes.trim() || null,
    items: lines.map(l => ({
      id: l.id,
      key: l.key,
      product_id: l.product.id,
      supplier_id: l.supplier_id,
      doc_number: l.doc_number.trim() || null,
      pack_size: l.pack_size.trim() === '' ? 1 : (parseQty(l.pack_size) ?? 1),
      quantity: parseQty(l.quantity) ?? 0,
      unit_cost: parseMoney(l.unit_cost) ?? 0,
      // Sent only when changed here, so an autosave never overwrites a value
      // someone else set on the product meanwhile.
      needs_label: l.label_changed ? l.needs_label : null,
      label_kind: l.label_changed ? l.label_kind : null,
      plan: planOf(l),
    })),
  }
}

export function draftTotals(lines: DraftLineState[]): { lines: number; units: number; value: number } {
  let units = 0
  let value = 0
  for (const l of lines) {
    const q = parseQty(l.quantity) ?? 0
    units += q
    value += q * (parseMoney(l.unit_cost) ?? 0)
  }
  return { lines: lines.length, units, value }
}

/** Why "Запиши" cannot go yet, or null. */
export function saveBlocker(lines: DraftLineState[]): string | null {
  if (lines.length === 0) return 'Добавете поне един ред'
  const incomplete = lines.findIndex(l => lineProblem(l) != null)
  if (incomplete >= 0) return `Ред ${incomplete + 1} („${lines[incomplete].product.name}“): липсва ${lineProblem(lines[incomplete])}`
  const over = lines.findIndex(l => lineOverPlanned(l) > 0)
  if (over >= 0) return `Ред ${over + 1} („${lines[over].product.name}“): разпределено е повече от количеството`
  return null
}
