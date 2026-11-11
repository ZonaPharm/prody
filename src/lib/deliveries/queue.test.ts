import { describe, expect, it } from 'vitest'
import { daysWaiting, deliveryNextSteps, labelItems, labelSplit, readyByStore, splitText, storeReadyText, type LabelItemRow, type QueuePlanRow } from './queue'

function row(p: Partial<QueuePlanRow> & Pick<QueuePlanRow, 'plan_id' | 'item_id' | 'store_id'>): QueuePlanRow {
  return {
    planned_qty: 0, ready_qty: 0, shipped_qty: 0, received_qty: 0, sort_order: 0,
    delivery_id: 'd1', delivery_number: 1, product_id: 'p', product_name: 'Крем', product_sku: null,
    product_price: 8.9, needs_label: true, image: null, ...p,
  }
}

const names: Record<string, string> = { a: 'Ботев', b: 'Варна', c: 'Заимов' }
const name = (id: string) => names[id]

function item(p: Partial<LabelItemRow> & Pick<LabelItemRow, 'item_id'>): LabelItemRow {
  return {
    delivery_id: 'd1', delivery_number: 29, sort_order: 0, product_id: 'p', product_name: 'Крем', product_sku: null,
    product_price: 8.9, needs_label: true, image: null, received_qty: 0, labelled_qty: 0, plan: [], ...p,
  }
}

describe('labelItems', () => {
  it('every received unit waits for a label, also those staying in Офис', () => {
    // Д-000029: 20 creams received, 10 for Ботев, nothing for the rest.
    const q = labelItems([
      item({ item_id: 'i', received_qty: 20, plan: [{ store_id: 'a', planned_qty: 10, ready_qty: 0 }, { store_id: 'c', planned_qty: 0, ready_qty: 0 }] }),
      item({ item_id: 'j', received_qty: 5, sort_order: 1 }),
    ], name)
    expect(q.map(r => [r.item_id, r.expected, splitText(r.split, name)])).toEqual([
      ['i', 20, 'Ботев 10 · Офис 10'],
      ['j', 5, 'Офис 5'],
    ])
  })

  it('leaves out lines fully labelled and lines with nothing received', () => {
    expect(labelItems([
      item({ item_id: 'i', received_qty: 5, labelled_qty: 5 }),
      item({ item_id: 'j', received_qty: 0 }),
    ], name)).toEqual([])
  })
})

describe('labelSplit', () => {
  it('fills the stores in name order, after the labelled units that already wait in Офис', () => {
    // 8 labelled, 6 of them ready for Заимов; 2 labelled wait; Ботев and Варна need 4 each.
    const line = {
      labelled_qty: 8,
      plan: [
        { store_id: 'c', planned_qty: 6, ready_qty: 6 },
        { store_id: 'b', planned_qty: 4, ready_qty: 0 },
        { store_id: 'a', planned_qty: 4, ready_qty: 0 },
      ],
    }
    expect(labelSplit(line, 10, name)).toEqual([
      { store_id: 'a', qty: 2 },
      { store_id: 'b', qty: 4 },
      { store_id: null, qty: 4 },
    ])
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

describe('deliveryNextSteps', () => {
  it('counts every received unit without a label, Офис included, and ready units not yet sent', () => {
    expect(deliveryNextSteps([
      { received_qty: 20, labelled_qty: 2, plan: [{ planned_qty: 6, ready_qty: 2, shipped_qty: 0 }, { planned_qty: 4, ready_qty: 0, shipped_qty: 0 }] },
      { received_qty: 3, labelled_qty: 0, plan: [] },
      { received_qty: 4, labelled_qty: 4, plan: [{ planned_qty: 4, ready_qty: 4, shipped_qty: 1 }] },
    ])).toEqual({ toLabel: 18 + 3, toShip: 2 + 3 })
  })

  it('is zero for nothing received and for everything sent', () => {
    expect(deliveryNextSteps([{ received_qty: 0, labelled_qty: 0, plan: [{ planned_qty: 5, ready_qty: 0, shipped_qty: 0 }] }])).toEqual({ toLabel: 0, toShip: 0 })
    expect(deliveryNextSteps([{ received_qty: 5, labelled_qty: 5, plan: [{ planned_qty: 5, ready_qty: 5, shipped_qty: 5 }] }])).toEqual({ toLabel: 0, toShip: 0 })
  })
})
