import type { Task } from '@/lib/deliveries/tasks'
import { formatOrderNumber } from './format'

/**
 * Cards on "Задачи" for admins: orders that wait for their goods, and orders
 * that arrived whose delivery still has to be checked against the invoice.
 * Pure: the rows come from getOrderTaskRows.
 */

export type OrderTaskRow = {
  id: string
  number: number
  status: 'sent' | 'received'
  supplier: string
  sent_at: string | null
  delivery_id: string | null
  delivery_status: string | null
}

/** Days between two Sofia dates (YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** After this many days without goods, the card asks to call the supplier. */
export const ORDER_LATE_DAYS = 7

export function orderTasks(rows: OrderTaskRow[], today: string, sofiaDay: (iso: string) => string): Task[] {
  const out: Task[] = []
  for (const r of rows) {
    const no = formatOrderNumber(r.number)
    if (r.status === 'received' && r.delivery_id && r.delivery_status === 'draft') {
      out.push({
        key: `order-check-${r.id}`, tone: 'do', icon: 'inbox', label: 'Стъпка 1: Доставка от поръчка',
        title: `Сверете доставката от ${no} (${r.supplier}) с фактурата`,
        detail: 'Поправете бройките и цените, махнете недошлото, добавете дошлото извън поръчката и запазете.',
        href: `/deliveries/${r.delivery_id}`, cta: 'Към доставката',
      })
    } else if (r.status === 'sent') {
      const days = r.sent_at ? daysBetween(sofiaDay(r.sent_at), today) : 0
      const late = days >= ORDER_LATE_DAYS
      out.push({
        key: `order-wait-${r.id}`, tone: late ? 'late' : 'coming', icon: 'package', label: 'Поръчка',
        title: `${no} от ${r.supplier} чака стоката`,
        when: days <= 0 ? 'поръчана днес' : days === 1 ? 'поръчана вчера' : `поръчана преди ${days} дни`,
        detail: late ? 'Стоката още я няма. Проверете при доставчика.' : 'Когато стоката дойде, натиснете „Пристигна“.',
        href: `/deliveries/orders/${r.id}`, cta: 'Пристигна',
      })
    }
  }
  return out
}

export async function getOrderTaskRows(supabase: any): Promise<OrderTaskRow[]> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('supplier_orders')
    .select('id, number, status, sent_at, delivery_id, supplier:suppliers(name), delivery:deliveries!supplier_orders_delivery_id_fkey(status)')
    .in('status', ['sent', 'received'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    supplier: r.supplier?.name ?? '—',
    sent_at: r.sent_at,
    delivery_id: r.delivery_id,
    delivery_status: r.delivery?.status ?? null,
  }))
}
