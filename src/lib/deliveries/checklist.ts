/**
 * The three checklists of phase 3 work the same way as "Получаване": the
 * system already knows what should be there, the person ticks a row when it is
 * right, and types a number only after "Не е наред". There is no "tick all".
 *
 *   label — "Етикетиране": delivery lines with received units still without a label
 *           (also those staying in Офис), ticked = labelled.
 *   pack  — the packing checklist of one shipment (П-…), ticked = in the boxes.
 *   store — the store's checklist of a shipment that arrived, ticked = received.
 *
 * Pure functions: the screens keep the state, these turn it into request bodies
 * and say what is wrong.
 */

export type Step = 'label' | 'pack' | 'store'

export type ProblemKind = 'partial' | 'short' | 'damaged' | 'wrong_label' | 'wrong_product' | 'missing' | 'other'

/** What a "Не е наред" becomes in delivery_signals (null: no signal, e.g. "Частично"). */
export type SignalReason = 'short' | 'damaged' | 'wrong_label' | 'wrong_product' | 'missing' | 'other'

export type Problem = { kind: ProblemKind; qty: number; note?: string }

export type RowState = { checked: boolean; problem: Problem | null }

export const STEP_KINDS: Record<Step, ProblemKind[]> = {
  label: ['partial', 'damaged', 'wrong_label', 'missing', 'other'],
  pack: ['partial', 'damaged', 'wrong_label', 'wrong_product', 'missing', 'other'],
  store: ['short', 'damaged', 'wrong_product', 'missing', 'other'],
}

export const KIND_LABEL: Record<Step, Partial<Record<ProblemKind, string>>> = {
  label: {
    partial: 'Частично (останалото по-късно)',
    damaged: 'Повредено',
    wrong_label: 'Грешен етикет',
    missing: 'Липсва в Офис',
    other: 'Друго',
  },
  pack: {
    partial: 'Частично (останалото с друг курс)',
    damaged: 'Повредено',
    wrong_label: 'Грешен етикет',
    wrong_product: 'Грешен продукт',
    missing: 'Липсва',
    other: 'Друго',
  },
  store: {
    short: 'По-малко',
    damaged: 'Повредено',
    wrong_product: 'Грешен продукт',
    missing: 'Липсва изцяло',
    other: 'Друго',
  },
}

/** The question above the number, per step and kind. */
export function qtyQuestion(step: Step, kind: ProblemKind): string {
  if (kind === 'damaged') {
    return step === 'store' ? 'Колко са здрави (остават за продажба)' : step === 'pack' ? 'Колко здрави сложихте в кашона' : 'Колко са здрави и етикетирани'
  }
  if (step === 'label') return 'Колко етикетирахте'
  if (step === 'pack') return 'Колко сложихте в кашона'
  return 'Колко пристигнаха'
}

/** "Частично" is the only kind without a signal (label and pack only). */
export function signalReason(kind: ProblemKind): SignalReason | null {
  return kind === 'partial' ? null : kind
}

/** Kinds where nothing usable came: no number to type, the quantity is 0. */
export function kindNeedsQty(kind: ProblemKind): boolean {
  return kind !== 'missing' && kind !== 'wrong_product'
}

/**
 * A problem's number must be below what the row expects (that is what "not in
 * order" means). "Частично" when labelling needs at least 1, otherwise there is
 * nothing to record. "Друго" needs a note.
 */
export function problemError(step: Step, problem: Problem, expected: number): string | null {
  if (!STEP_KINDS[step].includes(problem.kind)) return 'Изберете какво не е наред'
  if (problem.kind === 'other' && !problem.note?.trim()) return 'Напишете кратка бележка'
  if (!kindNeedsQty(problem.kind)) return null
  const qty = problem.qty
  if (!Number.isInteger(qty) || qty < 0) return 'Въведете цяло число'
  if (step === 'label' && problem.kind === 'partial' && qty <= 0) return 'При „Частично“ готовите са поне 1'
  if (qty >= expected) return `Трябва да е под ${expected} бр.`
  return null
}

/** The units a row stands for: all it expects when ticked, the typed number after "Не е наред". */
export function rowQty(state: RowState | undefined, expected: number): number | null {
  if (!state) return null
  if (state.problem) return kindNeedsQty(state.problem.kind) ? state.problem.qty : 0
  return state.checked ? expected : null
}

export type SignalBody = {
  reason: SignalReason
  qty_expected: number
  qty_actual: number
  note: string | null
}

function signalFor(problem: Problem, expected: number): SignalBody | null {
  const reason = signalReason(problem.kind)
  if (!reason) return null
  return {
    reason,
    qty_expected: expected,
    qty_actual: kindNeedsQty(problem.kind) ? problem.qty : 0,
    note: problem.note?.trim() || null,
  }
}

// ---------------------------------------------------------------------------
// "Етикетиране"
// ---------------------------------------------------------------------------

export type LabelRow = {
  item_id: string
  /** received − labelled: what a tick labels. */
  expected: number
}

export type LabelBody = {
  rows: { item_id: string; qty: number }[]
  signals: ({ item_id: string } & SignalBody)[]
}

export function buildLabelBody(rows: LabelRow[], state: Record<string, RowState>): LabelBody {
  const body: LabelBody = { rows: [], signals: [] }
  for (const row of rows) {
    const s = state[row.item_id]
    const qty = rowQty(s, row.expected)
    if (qty == null) continue
    if (qty > 0) body.rows.push({ item_id: row.item_id, qty })
    const sig = s?.problem ? signalFor(s.problem, row.expected) : null
    if (sig) body.signals.push({ item_id: row.item_id, ...sig })
  }
  return body
}

// ---------------------------------------------------------------------------
// Packing one shipment
// ---------------------------------------------------------------------------

export type PackRow = { line_id: string; qty: number }

export type PackBody = {
  lines: { line_id: string; qty: number }[]
  signals: ({ line_id: string } & SignalBody)[]
}

/** Every line must be ticked or marked; the lines list is complete or the result is null. */
export function buildPackBody(rows: PackRow[], state: Record<string, RowState>): { body: PackBody; missing: number } {
  const body: PackBody = { lines: [], signals: [] }
  let missing = 0
  for (const row of rows) {
    const s = state[row.line_id]
    const qty = rowQty(s, row.qty)
    if (qty == null) {
      missing++
      continue
    }
    body.lines.push({ line_id: row.line_id, qty })
    const sig = s?.problem ? signalFor(s.problem, row.qty) : null
    if (sig) body.signals.push({ line_id: row.line_id, ...sig })
  }
  return { body, missing }
}

// ---------------------------------------------------------------------------
// The store's checklist
// ---------------------------------------------------------------------------

export type ConfirmLine = { line_id: string; received_qty: number; reason?: SignalReason; note?: string | null }

export function buildConfirmBody(rows: PackRow[], state: Record<string, RowState>): { lines: ConfirmLine[]; missing: number } {
  const lines: ConfirmLine[] = []
  let missing = 0
  for (const row of rows) {
    const s = state[row.line_id]
    const qty = rowQty(s, row.qty)
    if (qty == null) {
      missing++
      continue
    }
    if (s?.problem) {
      const reason = signalReason(s.problem.kind) ?? 'short'
      lines.push({ line_id: row.line_id, received_qty: qty, reason, note: s.problem.note?.trim() || null })
    } else {
      lines.push({ line_id: row.line_id, received_qty: qty })
    }
  }
  return { lines, missing }
}

// ---------------------------------------------------------------------------

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** "12 реда, 340 бр., 1 проблем" — what the signature confirms. */
export function checklistSummary(rows: number, units: number, problems: number): string {
  return `${rows} ${plural(rows, 'ред', 'реда')}, ${units} бр.${problems ? `, ${problems} ${plural(problems, 'проблем', 'проблема')}` : ''}`
}
