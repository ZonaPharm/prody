/**
 * "Дата на поръчка" in the product form: the saved date when a product is
 * edited (empty stays empty), today's date (Sofia) for a new product.
 */
export function initialOrderDate(
  saved: string | null | undefined,
  isNew: boolean,
  today: string,
): string {
  if (saved) return saved.split('T')[0]
  return isNew ? today : ''
}
