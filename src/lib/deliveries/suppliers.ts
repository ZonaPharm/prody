/**
 * Which supplier to suggest for a product the admin adds to a delivery:
 * the supplier of its last delivery line, otherwise the supplier whose name
 * matches the product's old free-text "Източник" (products.source), with the
 * same merges the phase 1 seed made (Тему → Temu, Панацея → Панацея 2001).
 */

export function normalizeSupplierName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

const MERGES: Record<string, string> = {
  'тему': 'temu',
  'панацея': 'панацея 2001',
}

export function canonicalSupplierKey(name: string | null | undefined): string {
  const n = normalizeSupplierName(name)
  return MERGES[n] ?? n
}

export type SupplierRef = { id: string; name: string; is_active?: boolean }

export function supplierForSource(source: string | null | undefined, suppliers: SupplierRef[]): SupplierRef | null {
  const key = canonicalSupplierKey(source)
  if (!key) return null
  return suppliers.find(s => canonicalSupplierKey(s.name) === key) ?? null
}
