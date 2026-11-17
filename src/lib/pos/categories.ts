/**
 * The supplier buttons (categories) above the products, on the till and in
 * Заявки. They show one line; "Покажи още" opens the rest. The ones the store
 * sells most come first, so the line holds what the seller needs most often.
 * Pure, so it is tested without a browser.
 */

export type Category = { id: string; name: string }

/**
 * Most sold in the store first (one sale line counts once), then the rest
 * alphabetically, the way they were listed before.
 *
 * productCategory maps product id to its category; soldProductIds holds one
 * entry per sale line of the store (the till reads the last 90 days).
 */
export function orderCategoriesByUse<C extends Category>(
  categories: C[],
  productCategory: Map<string, string | null> | Record<string, string | null | undefined>,
  soldProductIds: string[],
): C[] {
  const catOf = (id: string) => productCategory instanceof Map ? productCategory.get(id) : productCategory[id]
  const uses: Record<string, number> = {}
  for (const pid of soldProductIds) {
    const c = catOf(pid)
    if (c) uses[c] = (uses[c] || 0) + 1
  }
  return [...categories].sort((a, b) =>
    (uses[b.id] || 0) - (uses[a.id] || 0) || a.name.localeCompare(b.name, 'bg'))
}

/**
 * How many buttons sit on the first line, from the top edge of each button
 * in the order drawn. A button that wrapped to the next line has a larger top.
 */
export function countFirstLine(tops: number[]): number {
  if (tops.length === 0) return 0
  const first = tops[0]
  let n = 0
  for (const t of tops) {
    if (Math.abs(t - first) > 2) break
    n++
  }
  return n
}

/**
 * What the closed list draws: the picked supplier right after "Всички", so it
 * stays in sight once the list closes (also one picked from "Покажи още"),
 * the rest in their order. It depends on the pick only, never on what fitted
 * on the line, so measuring the line cannot make the buttons jump back and forth.
 */
export function closedOrder<C extends Category>(categories: C[], selectedId: string | null): C[] {
  const i = selectedId ? categories.findIndex(c => c.id === selectedId) : -1
  if (i <= 0) return categories
  return [categories[i], ...categories.slice(0, i), ...categories.slice(i + 1)]
}
