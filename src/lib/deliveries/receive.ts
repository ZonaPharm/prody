/**
 * The receiving checklist: one row per delivery line that still waits for
 * units. The person ticks a row when everything still expected arrived, or
 * presses "Не е наред" and picks what happened. Only then is a number typed.
 * This turns the screen state into the body of POST /api/deliveries/[id]/receive.
 */

export type ReceiveProblem =
  | { kind: 'partial'; qty: number; note?: string } // Частично: N arrived, the rest is still expected (no signal)
  | { kind: 'short'; qty: number; note?: string } // По-малко: N arrived, the rest will not come (signal)
  | { kind: 'damaged'; qty: number; note?: string } // Повредено: N usable go in (signal)
  | { kind: 'wrong_product'; note?: string } // nothing goes in (signal)
  | { kind: 'missing'; note?: string } // nothing goes in (signal)
  | { kind: 'other'; qty: number; note: string } // N go in (signal, note required)

export type ReceiveRowState = { checked: boolean; problem: ReceiveProblem | null }

export type ReceiveRow = { item_id: string; remaining: number }

export type ReceiveBody = {
  lines: { item_id: string; qty: number }[]
  signals: {
    item_id: string
    reason: 'short' | 'damaged' | 'wrong_product' | 'missing' | 'other'
    qty_expected: number
    qty_actual: number
    note: string | null
  }[]
}

export const PROBLEM_LABEL: Record<ReceiveProblem['kind'], string> = {
  partial: 'Частично (останалото идва по-късно)',
  short: 'По-малко (останалото няма да дойде)',
  damaged: 'Повредено',
  wrong_product: 'Грешен продукт',
  missing: 'Липсва изцяло',
  other: 'Друго',
}

/** Whether the problem asks how many units actually arrived in good order. */
export function problemNeedsQty(kind: ReceiveProblem['kind']): boolean {
  return kind === 'partial' || kind === 'short' || kind === 'damaged' || kind === 'other'
}

/** A problem's quantity must be below what is still expected (0 allowed except for "Частично"). */
export function problemError(problem: ReceiveProblem, remaining: number): string | null {
  if (problem.kind === 'other' && !problem.note?.trim()) return 'Напишете кратка бележка'
  if (!problemNeedsQty(problem.kind)) return null
  const qty = (problem as { qty: number }).qty
  if (!Number.isInteger(qty) || qty < 0) return 'Въведете цяло число'
  if (problem.kind === 'partial' && qty <= 0) return 'При „Частично“ пристигналите са поне 1'
  if (problem.kind !== 'other' && qty >= remaining) return `Трябва да е под очакваните ${remaining} бр.`
  if (problem.kind === 'other' && qty > remaining) return `Най-много ${remaining} бр.`
  return null
}

export function buildReceiveBody(rows: ReceiveRow[], state: Record<string, ReceiveRowState>): ReceiveBody {
  const body: ReceiveBody = { lines: [], signals: [] }
  for (const row of rows) {
    const s = state[row.item_id]
    if (!s) continue
    if (s.problem) {
      const p = s.problem
      const qty = problemNeedsQty(p.kind) ? (p as { qty: number }).qty : 0
      if (qty > 0) body.lines.push({ item_id: row.item_id, qty })
      if (p.kind !== 'partial') {
        body.signals.push({
          item_id: row.item_id,
          reason: p.kind,
          qty_expected: row.remaining,
          qty_actual: qty,
          note: p.note?.trim() || null,
        })
      }
    } else if (s.checked && row.remaining > 0) {
      body.lines.push({ item_id: row.item_id, qty: row.remaining })
    }
  }
  return body
}

/** "12 реда, 340 бр., 1 проблем" — what the signature confirms. */
export function receiveSummary(body: ReceiveBody): string {
  const rows = new Set([...body.lines.map(l => l.item_id), ...body.signals.map(s => s.item_id)]).size
  const units = body.lines.reduce((s, l) => s + l.qty, 0)
  const problems = body.signals.length
  const rowWord = rows === 1 ? 'ред' : 'реда'
  const problemWord = problems === 1 ? 'проблем' : 'проблема'
  return `${rows} ${rowWord}, ${units} бр.${problems ? `, ${problems} ${problemWord}` : ''}`
}
