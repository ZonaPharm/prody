import { describe, expect, it } from 'vitest'
import { daysWaiting, defaultSplit, deliveryNextSteps, labelItems, labelSplit, readyByStore, splitError, splitTargets, splitText, storeReadyText, type LabelItemRow, type QueuePlanRow } from './queue'

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

describe('labelling in part: where the units go', () => {
  // 20 received: Ботев 6, Варна 4 planned, Офис 10.
  const line = item({ item_id: 'i', received_qty: 20, plan: [{ store_id: 'b', planned_qty: 4, ready_qty: 0 }, { store_id: 'a', planned_qty: 6, ready_qty: 0 }] })

  it('each store up to what it still needs, Офис up to its share, stores by name', () => {
    expect(splitTargets(line, name)).toEqual([
      { store_id: 'a', cap: 6 },
      { store_id: 'b', cap: 4 },
      { store_id: null, cap: 10 },
    ])
  })

  it('Офис share less the labelled units no store has; full stores left out', () => {
    // 5 labelled earlier: 3 ready for Варна, 2 kept in Офис.
    const l = item({ item_id: 'i', received_qty: 20, labelled_qty: 5, plan: [{ store_id: 'b', planned_qty: 4, ready_qty: 3 }, { store_id: 'a', planned_qty: 6, ready_qty: 0 }] })
    expect(splitTargets(l, name)).toEqual([
      { store_id: 'a', cap: 6 },
      { store_id: 'b', cap: 1 },
      { store_id: null, cap: 8 },
    ])
    expect(splitTargets(l, name).reduce((n, t) => n + t.cap, 0)).toBe(15)
  })

  it('starts from the stores by name, then Офис', () => {
    const t = splitTargets(line, name)
    expect(defaultSplit(t, 8)).toEqual([{ store_id: 'a', qty: 6 }, { store_id: 'b', qty: 2 }])
    expect(defaultSplit(t, 12)).toEqual([{ store_id: 'a', qty: 6 }, { store_id: 'b', qty: 4 }, { store_id: null, qty: 2 }])
  })

  it('says what is wrong: over a store, outside the plan, not adding up', () => {
    const t = splitTargets(line, name)
    expect(splitError(t, [{ store_id: 'b', qty: 3 }, { store_id: null, qty: 2 }], 5, name)).toBeNull()
    expect(splitError(t, [{ store_id: 'b', qty: 5 }], 5, name)).toBe('Към Варна остават по план 4 бр.')
    expect(splitError(t, [{ store_id: 'c', qty: 1 }], 1, name)).toBe('Заимов не е в плана')
    expect(splitError(t, [{ store_id: 'a', qty: 2 }], 5, name)).toBe('Разпределете точно 5 бр. (сега 2 бр.)')
    expect(splitError(t, [{ store_id: 'a', qty: NaN }], 5, name)).toBe('Въведете цели бройки')
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

describe('readyLinesByStore', () => {
  it('lists per store what a new trip would take, minus what is already on a trip', async () => {
    const { readyLinesByStore } = await import('./queue')
    const base = { item_id: 'i', received_qty: 10, sort_order: 0, delivery_id: 'd1', delivery_number: 29, product_sku: null, product_price: null, needs_label: true, image: null }
    const rows = [
      { ...base, plan_id: 'p1', store_id: 'botev', planned_qty: 10, ready_qty: 10, shipped_qty: 0, product_id: 'a', product_name: 'Крем' },
      { ...base, plan_id: 'p2', store_id: 'botev', planned_qty: 5, ready_qty: 5, shipped_qty: 0, product_id: 'b', product_name: 'Балсам' },
      { ...base, plan_id: 'p3', store_id: 'mladost', planned_qty: 5, ready_qty: 5, shipped_qty: 5, product_id: 'b', product_name: 'Балсам' },
    ]
    const out = readyLinesByStore(rows, [{ plan_id: 'p1', qty: 4 }])
    expect(out.botev.map(l => [l.product_name, l.qty])).toEqual([['Балсам', 5], ['Крем', 6]])
    expect(out.mladost).toBeUndefined()
  })
})
