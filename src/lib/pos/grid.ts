/**
 * The till's product list on a phone: how much of it is drawn and what is in
 * the cart already. Pure, so it is tested without a browser.
 */

/** Rows drawn at first, and added each time the seller reaches the end. */
export const TILL_PAGE = 60

/**
 * A shop has some 800 active products. Drawing them all made the till page
 * about 100 000 px tall on a phone and slow to open; the seller finds a product
 * by searching anyway, so the list is drawn a page at a time.
 */
export function visiblePart<T>(list: T[], limit: number): { shown: T[]; more: number } {
  const n = Math.max(0, Math.floor(limit))
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) }
}

/** Pieces of each product in the cart, by product id, for the "в количката" mark. */
export function cartCounts(items: { product: { id: string }; qty: number }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of items) out[i.product.id] = (out[i.product.id] || 0) + i.qty
  return out
}
