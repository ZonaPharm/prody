import { describe, expect, it } from 'vitest'
import {
  buildConfirmBody,
  buildLabelBody,
  buildPackBody,
  checklistSummary,
  labelOverages,
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
  { plan_id: 'pa', item_id: 'i1', product_name: 'Крем', expected: 20, item_free: 30 },
  { plan_id: 'pb', item_id: 'i1', product_name: 'Крем', expected: 20, item_free: 30 },
  { plan_id: 'pc', item_id: 'i2', product_name: 'Чай', expected: 5, item_free: 5 },
]

describe('labelling', () => {
  it('ticked rows become ready, a damaged row its good units plus a signal, "Частично" no signal', () => {
    const body = buildLabelBody(labelRows, {
      pa: tick,
      pb: { checked: false, problem: { kind: 'damaged', qty: 8, note: ' смачкани ' } },
      pc: { checked: false, problem: { kind: 'partial', qty: 3 } },
    })
    expect(body.rows).toEqual([{ plan_id: 'pa', qty: 20 }, { plan_id: 'pb', qty: 8 }, { plan_id: 'pc', qty: 3 }])
    expect(body.signals).toEqual([{ plan_id: 'pb', reason: 'damaged', qty_expected: 20, qty_actual: 8, note: 'смачкани' }])
  })

  it('"Липсва" raises a signal and makes nothing ready', () => {
    const body = buildLabelBody(labelRows, { pc: { checked: false, problem: { kind: 'missing', qty: 0 } } })
    expect(body.rows).toEqual([])
    expect(body.signals).toEqual([{ plan_id: 'pc', reason: 'missing', qty_expected: 5, qty_actual: 0, note: null }])
  })

  it('rows of one product cannot together pass what was received', () => {
    const over = buildLabelBody(labelRows, { pa: tick, pb: tick })
    expect(labelOverages(labelRows, over)).toEqual([expect.stringMatching(/„Крем“: в Офис има 30 бр\..*40 бр\./)])
    const ok = buildLabelBody(labelRows, { pa: tick, pb: { checked: false, problem: { kind: 'partial', qty: 10 } } })
    expect(labelOverages(labelRows, ok)).toEqual([])
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
