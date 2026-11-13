/**
 * What label a product needs (products.label_kind). Only "Пълен етикет" goes through
 * "Етикетиране"; the database keeps products.needs_label = (label_kind = 'full').
 */
export const LABEL_KINDS = ['full', 'price', 'none'] as const
export type LabelKind = (typeof LABEL_KINDS)[number]

export const LABEL_KIND_LABEL: Record<LabelKind, string> = {
  full: 'Пълен етикет',
  price: 'Само цена',
  none: 'Готов',
}

export const LABEL_KIND_HINT: Record<LabelKind, string> = {
  full: 'Няма свой баркод, описание или цена. Минава през „Етикетиране“.',
  price: 'Има фабричен баркод, слага се само стикер с цена. Не минава през „Етикетиране“.',
  none: 'Идва готов, както си е. Не минава през „Етикетиране“.',
}

/** A product's kind; before the column existed, from needs_label. */
export function labelKindOf(p: { label_kind?: string | null; needs_label?: boolean | null }): LabelKind {
  if (p.label_kind === 'full' || p.label_kind === 'price' || p.label_kind === 'none') return p.label_kind
  return p.needs_label === false ? 'none' : 'full'
}
