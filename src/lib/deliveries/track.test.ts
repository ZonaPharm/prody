import { describe, expect, it } from 'vitest'
import { STAGE_ORDER, whereabouts, whereSummary, type TrackLine } from './track'

const plan = (id: string, store_id: string, planned_qty: number, ready_qty = 0, shipped_qty = 0) => ({ id, store_id, planned_qty, ready_qty, shipped_qty })
const line = (plan_id: string, qty: number, shipment_status: TrackLine['shipment_status'], received_qty: number | null = null): TrackLine => ({
  plan_id, qty, received_qty, shipment_id: 's1', shipment_number: 7, shipment_status, trip_id: 't1', trip_number: 3,
})
const sum = (t: Record<string, number>) => STAGE_ORDER.reduce((s, k) => s + t[k], 0)

describe('whereabouts', () => {
  it('nothing received yet: all units wait to be received', () => {
    const w = whereabouts({ quantity: 20, received_qty: 0, labelled_qty: 0, plan: [plan('p1', 'botev', 10)] }, [])
    expect(w.totals.not_received).toBe(20)
    expect(w.forStores).toEqual([{ store_id: 'botev', qty: 10 }])
    expect(whereSummary(w)).toBe('Чакат: получаване 20 бр.')
  })

  it('received, not labelled: everything waits for the label in Офис', () => {
    const w = whereabouts({ quantity: 20, received_qty: 20, labelled_qty: 0, plan: [plan('p1', 'botev', 10)] }, [])
    expect(w.totals.to_label).toBe(20)
    expect(w.totals.not_received).toBe(0)
    expect(whereSummary(w)).toBe('Чакат: етикет 20 бр.')
  })

  it('100 labelled and signed: the store share waits for a trip, the rest stays in Офис', () => {
    const w = whereabouts({ quantity: 100, received_qty: 100, labelled_qty: 100, plan: [plan('p1', 'botev', 60, 60), plan('p2', 'mladost', 30, 30)] }, [])
    expect(w.totals.to_trip).toBe(90)
    expect(w.totals.office).toBe(10)
    expect(w.parts.filter(p => p.stage === 'to_trip').map(p => [p.store_id, p.qty])).toEqual([['botev', 60], ['mladost', 30]])
    expect(sum(w.totals)).toBe(100)
    expect(whereSummary(w)).toBe('Чакат: курс 90 бр.')
  })

  it('on a trip that has not left, on the way, and accepted', () => {
    const w = whereabouts(
      { quantity: 30, received_qty: 30, labelled_qty: 30, plan: [plan('p1', 'botev', 10, 10, 10), plan('p2', 'mladost', 10, 10, 10), plan('p3', 'center', 10, 10, 0)] },
      [line('p1', 10, 'received', 9), line('p2', 10, 'sent'), line('p3', 6, 'packed')],
    )
    expect(w.totals).toMatchObject({ accepted: 10, on_way: 10, on_trip: 6, to_trip: 4, office: 0 })
    expect(w.parts.find(p => p.stage === 'accepted')).toMatchObject({ store_id: 'botev', missing: 1, trip_number: 3 })
    expect(sum(w.totals)).toBe(30)
  })

  it('a cancelled shipment line does not count: its units wait for the next trip', () => {
    const w = whereabouts({ quantity: 10, received_qty: 10, labelled_qty: 10, plan: [plan('p1', 'botev', 10, 10)] }, [line('p1', 10, 'cancelled')])
    expect(w.totals.to_trip).toBe(10)
    expect(w.totals.on_trip).toBe(0)
  })

  it('done: everything accepted', () => {
    const w = whereabouts({ quantity: 10, received_qty: 10, labelled_qty: 10, plan: [plan('p1', 'botev', 10, 10, 10)] }, [line('p1', 10, 'received', 10)])
    expect(whereSummary(w)).toBe('Всичко е прието в магазините')
  })

  it('done: no plan, all in Офис with labels', () => {
    const w = whereabouts({ quantity: 5, received_qty: 5, labelled_qty: 5, plan: [] }, [])
    expect(whereSummary(w)).toBe('Всичко е в Офис, с етикет')
  })
})
