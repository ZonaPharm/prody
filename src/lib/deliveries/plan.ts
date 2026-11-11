/**
 * The per-store plan of one delivery line: what the screen computes while the
 * admin types. The database checks the same rules again (save_delivery,
 * update_plan); this is only so the screen can say it first.
 */

export type PlanInput = Record<string, number> // store_id → planned units

export function plannedTotal(plan: PlanInput): number {
  return Object.values(plan).reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0), 0)
}

/** Units of the line that stay in Офис: never negative on screen. */
export function unallocated(quantity: number, plan: PlanInput): number {
  return Math.max(0, (quantity || 0) - plannedTotal(plan))
}

/** By how much the plan exceeds the line (0 when it fits). */
export function overPlanned(quantity: number, plan: PlanInput): number {
  return Math.max(0, plannedTotal(plan) - (quantity || 0))
}

/**
 * "Равно по всички": the same whole number for every store; what does not
 * divide evenly stays in Офис rather than going to an arbitrary store.
 */
export function equalSplit(quantity: number, storeIds: string[]): PlanInput {
  const out: PlanInput = {}
  if (!storeIds.length || !(quantity > 0)) return out
  const each = Math.floor(quantity / storeIds.length)
  for (const id of storeIds) out[id] = each
  return out
}

/** Rows to send: stores with more than zero, as whole numbers. */
export function planRows(plan: PlanInput): { store_id: string; planned_qty: number }[] {
  return Object.entries(plan)
    .map(([store_id, v]) => ({ store_id, planned_qty: Number.isFinite(v) ? Math.floor(v) : 0 }))
    .filter(r => r.planned_qty > 0)
}

/** Short summary for a collapsed line: "Заимов 20, Ботев 10 · Офис 70". */
export function planSummary(
  quantity: number,
  plan: PlanInput,
  stores: { id: string; name: string }[],
  warehouseName = 'Офис',
): string {
  const parts = stores
    .filter(s => (plan[s.id] ?? 0) > 0)
    .map(s => `${s.name} ${plan[s.id]}`)
  const rest = unallocated(quantity, plan)
  const head = parts.length ? parts.join(', ') : 'Без разпределение'
  return `${head} · ${warehouseName} ${rest}`
}
