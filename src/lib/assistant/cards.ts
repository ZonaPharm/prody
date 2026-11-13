/**
 * What a card in the chat is, shared by the server and the browser (no
 * database code here, so the chat screen can import it).
 */
import { LABEL_KIND_LABEL } from '@/lib/label-kind'

export const ACTION_KINDS = ['delivery_draft', 'supplier_order', 'product_create', 'product_update', 'excel', 'document'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export type ActionCard = {
  id: string
  kind: ActionKind
  title: string
  status: 'proposed' | 'done' | 'dismissed'
  payload: any
  result: any
}

/** Fields of a product the assistant may propose to change, and how the card names them. */
export const PRODUCT_FIELDS = {
  name: 'Име',
  description: 'Описание',
  price: 'Продажна цена',
  cost_price: 'Доставна цена',
  min_quantity: 'Минимално количество',
  barcode: 'Фабричен баркод',
  category_id: 'Категория',
  label_kind: 'Етикет',
  small_item: 'Малък продукт',
  status: 'Статус',
} as const
export type ProductField = keyof typeof PRODUCT_FIELDS

/** For the card: "Пълен етикет", "Активен"… */
export function fieldValueText(field: ProductField, value: any, names: Record<string, string> = {}): string {
  if (value == null || value === '') return '—'
  if (field === 'label_kind') return LABEL_KIND_LABEL[value as keyof typeof LABEL_KIND_LABEL] ?? String(value)
  if (field === 'status') return value === 'active' ? 'Активен' : 'Неактивен'
  if (field === 'small_item') return value ? 'Да' : 'Не'
  if (field === 'category_id') return names[value] ?? String(value)
  if (field === 'price' || field === 'cost_price') return `${Number(value).toFixed(2).replace('.', ',')} €`
  return String(value)
}
