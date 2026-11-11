import { describe, expect, it } from 'vitest'
import {
  buildConfirmBody,
  buildLabelBody,
  buildPackBody,
  checklistSummary,
  problemError,
  rowQty,
  type LabelRow,
  type RowState,
} from './checklist'

const tick: RowState = { checked: true, problem: null }

describe('problemError', () => {
  it('asks for a number below what the row expects', () => {
    expect(problemError('pack', { kind: 'damaged', qty: 5 }, 5)).toMatch(/под 5/)
    expect(problemError('pack', { kind: 'damaged', qty: 4 }, 5)).toBeNull()
    expect(problemError('store', { kind: 'short', qty: Number.NaN }, 5)).toMatch(/цяло число/)
  })

  it('"Частично" when labelling needs at least one ready unit; packing may leave a line out', () => {
    expect(problemError('label', { kind: 'partial', qty: 0 }, 5)).toMatch(/поне 1/)
    expect(problemError('pack', { kind: 'partial', qty: 0 }, 5)).toBeNull()
  })

  it('"Друго" needs a note; "Липсва" needs no number', () => {
    expect(problemError('store', { kind: 'other', qty: 1 }, 5)).toMatch(/бележка/)
    expect(problemError('store', { kind: 'missing', qty: 0 }, 5)).toBeNull()
  })

  it('refuses a kind the step does not offer', () => {
    expect(problemError('store', { kind: 'partial', qty: 1 }, 5)).toMatch(/Изберете/)
    expect(problemError('label', { kind: 'short', qty: 1 }, 5)).toMatch(/Изберете/)
  })
})

describe('rowQty', () => {
  it('is everything expected when ticked, the typed number on a problem, nothing otherwise', () => {
    expect(rowQty(undefined, 6)).toBeNull()
    expect(rowQty({ checked: false, problem: null }, 6)).toBeNull()
    expect(rowQty(tick, 6)).toBe(6)
    expect(rowQty({ checked: false, problem: { kind: 'damaged', qty: 2 } }, 6)).toBe(2)
    expect(rowQty({ checked: false, problem: { kind: 'missing', qty: 9 } }, 6)).toBe(0)
  })
})

const labelRows: LabelRow[] = [
  { item_id: 'i1', expected: 20 },
  { item_id: 'i2', expected: 20 },
  { item_id: 'i3', expected: 5 },
]

describe('labelling', () => {
  it('ticked lines are labelled whole, a damaged line its good units plus a signal, "Частично" no signal', () => {
    const body = buildLabelBody(labelRows, {
      i1: tick,
      i2: { checked: false, problem: { kind: 'damaged', qty: 8, note: ' смачкани ' } },
      i3: { checked: false, problem: { kind: 'partial', qty: 3 } },
    })
    expect(body.rows).toEqual([{ item_id: 'i1', qty: 20 }, { item_id: 'i2', qty: 8 }, { item_id: 'i3', qty: 3 }])
    expect(body.signals).toEqual([{ item_id: 'i2', reason: 'damaged', qty_expected: 20, qty_actual: 8, note: 'смачкани' }])
  })

  it('a row done in part carries where its units go; a whole row or an empty split none', () => {
    const body = buildLabelBody(labelRows, {
      i1: tick,
      i2: { checked: false, problem: { kind: 'partial', qty: 5 } },
      i3: { checked: false, problem: { kind: 'partial', qty: 2 } },
    }, {
      i1: [{ store_id: 'a', qty: 20 }],
      i2: [{ store_id: 'a', qty: 3 }, { store_id: null, qty: 2 }, { store_id: 'b', qty: 0 }],
    })
    expect(body.rows).toEqual([
      { item_id: 'i1', qty: 20 },
      { item_id: 'i2', qty: 5, split: [{ store_id: 'a', qty: 3 }, { store_id: null, qty: 2 }] },
      { item_id: 'i3', qty: 2 },
    ])
  })

  it('"Липсва" raises a signal and labels nothing', () => {
    const body = buildLabelBody(labelRows, { i3: { checked: false, problem: { kind: 'missing', qty: 0 } } })
    expect(body.rows).toEqual([])
    expect(body.signals).toEqual([{ item_id: 'i3', reason: 'missing', qty_expected: 5, qty_actual: 0, note: null }])
  })
})

describe('packing', () => {
  const rows = [{ line_id: 'l1', qty: 6 }, { line_id: 'l2', qty: 4 }]

  it('counts the rows not yet ticked', () => {
    expect(buildPackBody(rows, { l1: tick }).missing).toBe(1)
  })

  it('lists every line: ticked whole, short with a signal', () => {
    const { body, missing } = buildPackBody(rows, { l1: tick, l2: { checked: false, problem: { kind: 'missing', qty: 0 } } })
    expect(missing).toBe(0)
    expect(body.lines).toEqual([{ line_id: 'l1', qty: 6 }, { line_id: 'l2', qty: 0 }])
    expect(body.signals).toEqual([{ line_id: 'l2', reason: 'missing', qty_expected: 4, qty_actual: 0, note: null }])
  })
})

describe('the store', () => {
  it('ticked lines are received whole; a short line carries its reason and note', () => {
    const { lines, missing } = buildConfirmBody([{ line_id: 'l1', qty: 6 }, { line_id: 'l2', qty: 4 }], {
      l1: tick,
      l2: { checked: false, problem: { kind: 'short', qty: 3, note: 'един по-малко' } },
    })
    expect(missing).toBe(0)
    expect(lines).toEqual([
      { line_id: 'l1', received_qty: 6 },
      { line_id: 'l2', received_qty: 3, reason: 'short', note: 'един по-малко' },
    ])
  })
})

describe('checklistSummary', () => {
  it('reads like the signature line', () => {
    expect(checklistSummary(12, 340, 1)).toBe('12 реда, 340 бр., 1 проблем')
    expect(checklistSummary(1, 5, 0)).toBe('1 ред, 5 бр.')
  })
})
