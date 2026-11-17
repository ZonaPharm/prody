import { describe, expect, it } from 'vitest'
import { buildReceiveBody, problemError, receiveSummary } from './receive'

const rows = [
  { item_id: 'i1', remaining: 120 },
  { item_id: 'i2', remaining: 24 },
  { item_id: 'i3', remaining: 10 },
  { item_id: 'i4', remaining: 5 },
]

describe('buildReceiveBody', () => {
  it('a ticked row receives everything still expected; an untouched row stays open', () => {
    const body = buildReceiveBody(rows, { i1: { checked: true, problem: null }, i2: { checked: false, problem: null } })
    expect(body).toEqual({ lines: [{ item_id: 'i1', qty: 120 }], signals: [] })
  })

  it('"Частично" receives what came and raises no signal (the rest is still expected)', () => {
    const body = buildReceiveBody(rows, { i1: { checked: false, problem: { kind: 'partial', qty: 40 } } })
    expect(body).toEqual({ lines: [{ item_id: 'i1', qty: 40 }], signals: [] })
  })

  it('"По-малко" receives what came and signals the shortfall to the admins', () => {
    const body = buildReceiveBody(rows, { i2: { checked: true, problem: { kind: 'short', qty: 20, note: ' липсва кашон ' } } })
    expect(body.lines).toEqual([{ item_id: 'i2', qty: 20 }])
    expect(body.signals).toEqual([{ item_id: 'i2', reason: 'short', qty_expected: 24, qty_actual: 20, note: 'липсва кашон' }])
  })

  it('"Липсва изцяло" and "Грешен продукт" put nothing into Офис', () => {
    const body = buildReceiveBody(rows, {
      i3: { checked: false, problem: { kind: 'missing' } },
      i4: { checked: false, problem: { kind: 'wrong_product', note: 'дойде друг крем' } },
    })
    expect(body.lines).toEqual([])
    expect(body.signals.map(s => [s.item_id, s.reason, s.qty_actual])).toEqual([['i3', 'missing', 0], ['i4', 'wrong_product', 0]])
  })

  it('a damaged row receives only the usable units', () => {
    const body = buildReceiveBody(rows, { i3: { checked: false, problem: { kind: 'damaged', qty: 0 } } })
    expect(body.lines).toEqual([])
    expect(body.signals[0]).toMatchObject({ reason: 'damaged', qty_expected: 10, qty_actual: 0 })
  })
})

describe('problemError', () => {
  it('keeps the typed number below what is expected', () => {
    expect(problemError({ kind: 'short', qty: 24 }, 24)).toMatch(/под очакваните 24/)
    expect(problemError({ kind: 'short', qty: 23 }, 24)).toBeNull()
    expect(problemError({ kind: 'partial', qty: 0 }, 24)).toMatch(/поне 1/)
    expect(problemError({ kind: 'short', qty: NaN }, 24)).toMatch(/цяло число/)
    expect(problemError({ kind: 'other', qty: 1, note: '' }, 24)).toMatch(/бележка/)
    expect(problemError({ kind: 'missing' }, 24)).toBeNull()
  })
})

describe('receiveSummary', () => {
  it('says what the signature confirms', () => {
    expect(receiveSummary({ lines: [{ item_id: 'a', qty: 300 }, { item_id: 'b', qty: 40 }], signals: [{ item_id: 'b', reason: 'short', qty_expected: 50, qty_actual: 40, note: null }] }))
      .toBe('2 реда, 340 бр., 1 проблем')
  })
})
