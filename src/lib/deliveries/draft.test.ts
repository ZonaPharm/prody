import { describe, expect, it } from 'vitest'
import { draftTotals, lineProblem, parseMoney, parseQty, saveBlocker, toDraftPayload, type DraftLineState } from './draft'

function line(over: Partial<DraftLineState> = {}): DraftLineState {
  return {
    key: 'k1',
    id: null,
    product: { id: 'p1', name: 'Крем', sku: null, image: null, status: 'active', price: 8.9 },
    supplier_id: 's1',
    doc_number: ' 123 ',
    quantity: '100',
    pack_size: '',
    unit_cost: '5,40',
    needs_label: true,
    plan: { a: '20', b: '', c: '10' },
    ...over,
  }
}

describe('parsing what was typed', () => {
  it('quantities are whole numbers', () => {
    expect(parseQty('12')).toBe(12)
    expect(parseQty(' 12 ')).toBe(12)
    expect(parseQty('1.5')).toBeNull()
    expect(parseQty('')).toBeNull()
  })

  it('prices take a comma or a point, up to four decimals', () => {
    expect(parseMoney('5,40')).toBe(5.4)
    expect(parseMoney('5.4')).toBe(5.4)
    expect(parseMoney('0')).toBe(0)
    expect(parseMoney('5,40 €')).toBeNull()
    expect(parseMoney('-1')).toBeNull()
  })
})

describe('a line', () => {
  it('names what is missing', () => {
    expect(lineProblem(line())).toBeNull()
    expect(lineProblem(line({ quantity: '' }))).toBe('количество')
    expect(lineProblem(line({ quantity: '0' }))).toBe('количество')
    expect(lineProblem(line({ unit_cost: '' }))).toBe('доставна цена')
    expect(lineProblem(line({ pack_size: '0' }))).toBe('бройки в кутия')
    expect(lineProblem(line({ plan: { a: 'x' } }))).toBe('разпределение')
  })

  it('becomes the autosave body: numbers, trimmed text, plan rows above zero', () => {
    expect(toDraftPayload({ order_ref: ' ', notes: 'бележка' }, [line()])).toEqual({
      order_ref: null,
      notes: 'бележка',
      items: [{
        id: null,
        key: 'k1',
        product_id: 'p1',
        supplier_id: 's1',
        doc_number: '123',
        pack_size: 1,
        quantity: 100,
        unit_cost: 5.4,
        needs_label: true,
        plan: [{ store_id: 'a', planned_qty: 20 }, { store_id: 'c', planned_qty: 10 }],
      }],
    })
  })
})

describe('the draft', () => {
  it('adds up lines, units and value', () => {
    const t = draftTotals([line(), line({ key: 'k2', quantity: '10', unit_cost: '1' })])
    expect(t).toEqual({ lines: 2, units: 110, value: 550 })
  })

  it('cannot be saved empty, with an incomplete line, or over-planned', () => {
    expect(saveBlocker([])).toBe('Добавете поне един ред')
    expect(saveBlocker([line({ unit_cost: '' })])).toMatch(/Ред 1 .*доставна цена/)
    expect(saveBlocker([line({ quantity: '20' })])).toMatch(/Ред 1 .*разпределено е повече/)
    expect(saveBlocker([line()])).toBeNull()
  })
})
