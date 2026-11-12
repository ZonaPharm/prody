import { describe, expect, it } from 'vitest'
import { deliveryJourney, tripJourney } from './journey'

const item = (o: Partial<{ quantity: number; received_qty: number; labelled_qty: number; needs_label: boolean; plan: { planned_qty: number; ready_qty: number; shipped_qty: number }[] }> = {}) => ({
  quantity: 10, received_qty: 0, labelled_qty: 0, needs_label: true, plan: [], ...o,
})
const states = (j: ReturnType<typeof deliveryJourney>) => j.steps.map(s => s.state)

describe('deliveryJourney', () => {
  it('nothing received: the next step is receiving', () => {
    const j = deliveryJourney({ id: 'd1', status: 'expected', items: [item()] })
    expect(states(j)).toEqual(['done', 'current', 'todo', 'todo'])
    expect(j.next).toEqual({ label: 'Получи стоката', href: '/deliveries/d1/receive' })
  })

  it('part received: offers the rest', () => {
    const j = deliveryJourney({ id: 'd1', status: 'in_progress', items: [item({ received_qty: 4 })] })
    expect(j.next?.label).toBe('Получи останалите 6 бр.')
    // labelling of what came is already possible and shows on the trail
    expect(j.steps[2]).toMatchObject({ state: 'current', href: '/deliveries/labels?delivery=d1' })
  })

  it('all received, labels missing: the next step is labelling', () => {
    const j = deliveryJourney({ id: 'd1', status: 'in_progress', items: [item({ received_qty: 10, labelled_qty: 3 })] })
    expect(states(j)).toEqual(['done', 'done', 'current', 'todo'])
    expect(j.next).toEqual({ label: 'Етикетирай 7 бр.', href: '/deliveries/labels?delivery=d1' })
  })

  it('products without a label skip the label step', () => {
    const j = deliveryJourney({ id: 'd1', status: 'in_progress', items: [item({ received_qty: 10, needs_label: false })] })
    expect(j.steps[2]).toMatchObject({ state: 'done', detail: 'не трябва' })
    expect(j.next).toBeNull()
    expect(j.finished).toBe(true)
  })

  it('labelled and ready for stores: the next step is a trip', () => {
    const j = deliveryJourney({
      id: 'd1', status: 'completed',
      items: [item({ received_qty: 10, labelled_qty: 10, plan: [{ planned_qty: 4, ready_qty: 4, shipped_qty: 0 }] })],
    })
    expect(states(j)).toEqual(['done', 'done', 'done', 'current'])
    expect(j.next).toEqual({ label: 'Направи курс за 4 бр.', href: '/deliveries/trips' })
  })

  it('everything shipped: finished, no next step', () => {
    const j = deliveryJourney({
      id: 'd1', status: 'completed',
      items: [item({ received_qty: 10, labelled_qty: 10, plan: [{ planned_qty: 4, ready_qty: 4, shipped_qty: 4 }] })],
    })
    expect(j.finished).toBe(true)
    expect(j.next).toBeNull()
  })

  it('a cancelled delivery offers nothing', () => {
    const j = deliveryJourney({ id: 'd1', status: 'cancelled', items: [item()] })
    expect(j.next).toBeNull()
  })
})

describe('tripJourney', () => {
  it('open trip with shipments to pack: the next step packs the first one', () => {
    const j = tripJourney({ status: 'open', shipments: [{ id: 's1', status: 'packed' }, { id: 's2', status: 'packing' }, { id: 's3', status: 'packing' }] })
    expect(j.steps.map(s => s.state)).toEqual(['current', 'todo', 'todo'])
    expect(j.next).toEqual({ label: 'Опаковай пратките (остават 2)', href: '/deliveries/shipments/s2/pack' })
  })

  it('everything packed: the driver is the current step', () => {
    const j = tripJourney({ status: 'open', shipments: [{ id: 's1', status: 'packed' }, { id: 's2', status: 'cancelled' }] })
    expect(j.steps.map(s => s.state)).toEqual(['done', 'current', 'todo'])
    expect(j.next).toBeNull()
  })

  it('departed: waits for the stores', () => {
    const j = tripJourney({ status: 'departed', shipments: [{ id: 's1', status: 'received' }, { id: 's2', status: 'sent' }] })
    expect(j.steps.map(s => s.state)).toEqual(['done', 'done', 'current'])
    expect(j.steps[2].detail).toBe('1 от 2 пратки')
  })
})
