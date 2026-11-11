import { describe, expect, it } from 'vitest'
import { daysWaiting, labelQueue, readyByStore, storeReadyText, type QueuePlanRow } from './queue'

function row(p: Partial<QueuePlanRow> & Pick<QueuePlanRow, 'plan_id' | 'item_id' | 'store_id'>): QueuePlanRow {
  return {
    planned_qty: 0, ready_qty: 0, shipped_qty: 0, received_qty: 0, sort_order: 0,
    delivery_id: 'd1', delivery_number: 1, product_id: 'p', product_name: 'Крем', product_sku: null,
    product_price: 8.9, needs_label: true, image: null, ...p,
  }
}

const names: Record<string, string> = { a: 'Ботев', b: 'Варна', c: 'Заимов' }
const name = (id: string) => names[id]

describe('labelQueue', () => {
  it('offers each store what it still needs, at most what was received and not labelled', () => {
    // 100 creams, 20 per store; 30 received, 10 already ready for Ботев.
    const q = labelQueue([
      row({ plan_id: 'p1', item_id: 'i', store_id: 'c', planned_qty: 20, received_qty: 30 }),
      row({ plan_id: 'p2', item_id: 'i', store_id: 'a', planned_qty: 20, ready_qty: 10, received_qty: 30 }),
      row({ plan_id: 'p3', item_id: 'i', store_id: 'b', planned_qty: 20, received_qty: 30 }),
    ], name)
    expect(q.map(r => [name(r.store_id), r.open, r.item_free, r.expected])).toEqual([
      ['Ботев', 10, 20, 10],
      ['Варна', 20, 20, 20],
      ['Заимов', 20, 20, 20],
    ])
  })

  it('leaves out rows that are fully ready and products with nothing received', () => {
    const q = labelQueue([
      row({ plan_id: 'p1', item_id: 'i1', store_id: 'a', planned_qty: 5, ready_qty: 5, received_qty: 5 }),
      row({ plan_id: 'p2', item_id: 'i2', store_id: 'a', planned_qty: 5, received_qty: 0 }),
    ], name)
    expect(q).toEqual([])
  })
})

describe('readyByStore', () => {
  it('counts ready minus shipped minus what already sits on a trip that has not left', () => {
    const rows = [
      row({ plan_id: 'p1', item_id: 'i1', store_id: 'a', ready_qty: 10, shipped_qty: 2, delivery_id: 'd1' }),
      row({ plan_id: 'p2', item_id: 'i2', store_id: 'a', ready_qty: 5, delivery_id: 'd2' }),
      row({ plan_id: 'p3', item_id: 'i3', store_id: 'b', ready_qty: 4, delivery_id: 'd1' }),
    ]
    const r = readyByStore(rows, [{ plan_id: 'p3', qty: 4 }, { plan_id: 'p1', qty: 3 }])
    expect(r).toEqual([{ store_id: 'a', rows: 2, units: 10, deliveries: 2 }])
    expect(storeReadyText(r[0])).toBe('готови 2 реда, 10 бр., от 2 доставки')
  })
})

describe('daysWaiting', () => {
  it('whole days since the shipment left', () => {
    const now = new Date('2026-11-14T10:00:00Z')
    expect(daysWaiting('2026-11-11T09:00:00Z', now)).toBe(3)
    expect(daysWaiting('2026-11-14T08:00:00Z', now)).toBe(0)
    expect(daysWaiting(null, now)).toBe(0)
  })
})
