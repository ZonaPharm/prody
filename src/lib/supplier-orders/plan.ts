import { overPlanned, plannedTotal, type PlanInput } from '@/lib/deliveries/plan'

/**
 * The split per store of an order to a supplier: how the screens show and check it
 * before saving. The database checks the same rules again (supplier_order_plan_problem).
 * What is not planned stays in Офис; the supplier never sees the split.
 */

/** Numbers from the database → the text the fields hold ('' for none). */
export function planText(plan: PlanInput | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(plan ?? {})) if (v > 0) out[k] = String(v)
  return out
}

/**
 * The first line whose stores get more than is ordered, as the message to show;
 * null when every line fits. A line with no quantity yet is left to the quantity check.
 */
export function overPlannedLine(lines: { name: string; quantity: number | null; plan: PlanInput }[]): string | null {
  for (const l of lines) {
    if (l.quantity == null) continue
    const over = overPlanned(l.quantity, l.plan)
    if (over > 0) return `„${l.name}“: за магазините са ${plannedTotal(l.plan)} бр., а поръчвате ${l.quantity}. Намалете магазините или поръчайте повече.`
  }
  return null
}

/** Units of the whole order that go to stores, and how many lines have any. */
export function planTotals(lines: { plan: PlanInput }[]): { units: number; lines: number } {
  let units = 0
  let withPlan = 0
  for (const l of lines) {
    const t = plannedTotal(l.plan)
    units += t
    if (t > 0) withPlan += 1
  }
  return { units, lines: withPlan }
}
