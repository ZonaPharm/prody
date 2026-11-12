import { describe, expect, it } from 'vitest'
import { orderTasks, type OrderTaskRow } from './tasks'

const day = (iso: string) => iso.slice(0, 10)
const row = (over: Partial<OrderTaskRow>): OrderTaskRow => ({
  id: 'o1', number: 12, status: 'sent', supplier: 'Панацея', sent_at: '2026-11-10T09:00:00Z', delivery_id: null, delivery_status: null, ...over,
})

describe('orderTasks', () => {
  it('a sent order waits for its goods', () => {
    const [t] = orderTasks([row({})], '2026-11-12', day)
    expect(t).toMatchObject({ tone: 'coming', title: 'ПР-000012 от Панацея чака стоката', when: 'поръчана преди 2 дни', href: '/deliveries/orders/o1', cta: 'Пристигна' })
  })
  it('today and yesterday read as words', () => {
    expect(orderTasks([row({ sent_at: '2026-11-12T08:00:00Z' })], '2026-11-12', day)[0].when).toBe('поръчана днес')
    expect(orderTasks([row({ sent_at: '2026-11-11T08:00:00Z' })], '2026-11-12', day)[0].when).toBe('поръчана вчера')
  })
  it('a week without goods is late', () => {
    const [t] = orderTasks([row({ sent_at: '2026-11-03T08:00:00Z' })], '2026-11-12', day)
    expect(t.tone).toBe('late')
    expect(t.detail).toContain('Проверете при доставчика')
  })
  it('an arrived order whose delivery is a draft asks to check it against the invoice', () => {
    const [t] = orderTasks([row({ status: 'received', delivery_id: 'd1', delivery_status: 'draft' })], '2026-11-12', day)
    expect(t).toMatchObject({ tone: 'do', href: '/deliveries/d1' })
    expect(t.title).toContain('фактурата')
  })
  it('an arrived order with its delivery saved gives no card', () => {
    expect(orderTasks([row({ status: 'received', delivery_id: 'd1', delivery_status: 'expected' })], '2026-11-12', day)).toEqual([])
  })
})
