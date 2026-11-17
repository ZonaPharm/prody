import { describe, expect, it } from 'vitest'
import {
  companyName,
  compareWithOrder,
  diffSentence,
  escapeHtml,
  formatOrderNumber,
  orderHtml,
  orderSubject,
  orderText,
  orderTotals,
  parseEmails,
  splitForSupplier,
  supplierBarcode,
  type OrderDoc,
} from './format'

const doc: OrderDoc = {
  number: 12,
  supplierName: 'Панацея 2001',
  contactName: 'г-жо Иванова',
  notes: 'Доставка до петък',
  lines: [
    { name: 'Боя за коса <тъмна>', barcode: '3800123456789', quantity: 10, note: 'цвят 5.0' },
    { name: 'Паста за зъби', barcode: null, quantity: 24, note: null },
  ],
  signature: 'Зона Фарма ЕООД\nгр. София, ул. Примерна 1\n0888 000 000',
  senderName: 'Владимир',
}

describe('formatOrderNumber', () => {
  it('pads to six digits with ПР-', () => {
    expect(formatOrderNumber(12)).toBe('ПР-000012')
    expect(formatOrderNumber(null)).toBe('')
  })
})

describe('parseEmails', () => {
  it('splits on commas, semicolons, spaces and new lines, drops repeats', () => {
    expect(parseEmails('A@x.bg, b@x.bg;\nc@y.com a@x.bg')).toEqual({ emails: ['a@x.bg', 'b@x.bg', 'c@y.com'], bad: [] })
  })
  it('lists what is not an address', () => {
    expect(parseEmails('orders@x.bg, панацея, x@y')).toEqual({ emails: ['orders@x.bg'], bad: ['панацея', 'x@y'] })
  })
  it('empty field gives no addresses', () => {
    expect(parseEmails('  ')).toEqual({ emails: [], bad: [] })
  })
})

describe('supplierBarcode', () => {
  it('keeps a manufacturer EAN and drops our in-store 2… codes', () => {
    expect(supplierBarcode('3800123456789')).toBe('3800123456789')
    expect(supplierBarcode('2000000012345')).toBeNull()
    expect(supplierBarcode('  ')).toBeNull()
    expect(supplierBarcode(null)).toBeNull()
  })
})

describe('companyName and subject', () => {
  it('takes the first line of the signature', () => {
    expect(companyName(doc.signature)).toBe('Зона Фарма ЕООД')
    expect(companyName(null)).toBe('Зона Фарма')
    expect(orderSubject(doc)).toBe('Поръчка ПР-000012 от Зона Фарма ЕООД')
  })
})

describe('orderText', () => {
  it('lists every line with its code, quantity and note, then totals and signature', () => {
    const t = orderText(doc)
    expect(t).toContain('Здравейте, г-жо Иванова,')
    expect(t).toContain('1. Боя за коса <тъмна> (3800123456789) — 10 бр. — цвят 5.0')
    expect(t).toContain('2. Паста за зъби — 24 бр.')
    expect(t).toContain('Общо: 2 продукта, 34 бр.')
    expect(t).toContain('Бележка: Доставка до петък')
    expect(t.trim().endsWith('0888 000 000')).toBe(true)
  })
  it('greets without a name when there is no contact', () => {
    expect(orderText({ ...doc, contactName: null, notes: null })).toMatch(/^Здравейте,\n/)
  })
})

describe('orderHtml', () => {
  it('escapes product names and shows the barcode and note columns only when used', () => {
    const h = orderHtml(doc)
    expect(h).toContain('Боя за коса &lt;тъмна&gt;')
    expect(h).toContain('>Баркод<')
    expect(h).toContain('>Бележка<')
    const plain = orderHtml({ ...doc, lines: [{ name: 'А', barcode: null, quantity: 1, note: null }] })
    expect(plain).not.toContain('>Баркод<')
    expect(plain).not.toContain('>Бележка<')
    expect(plain).toContain('Общо: 1 продукт, 1 бр.')
  })
  it('escapeHtml covers quotes', () => {
    expect(escapeHtml(`"a'&`)).toBe('&quot;a&#39;&amp;')
  })
})

describe('the split for the supplier', () => {
  const stores = [
    { id: 'w', name: 'Офис', is_warehouse: true },
    { id: 'a', name: 'Ботев', is_warehouse: false },
    { id: 'b', name: 'Заимов', is_warehouse: false },
    { id: 'c', name: 'Люлин', is_warehouse: false },
  ]

  it('splitForSupplier: a column per store that gets anything, then Офис for the rest', () => {
    expect(splitForSupplier([
      { quantity: 10, plan: { a: 4, b: 3 } },
      { quantity: 24, plan: { a: 24 } },
    ], stores)).toEqual({ columns: ['Ботев', 'Заимов', 'Офис'], rows: [[4, 3, 3], [24, 0, 0]] })
  })

  it('splitForSupplier: no Офис column when everything goes to stores; null when nothing is split', () => {
    expect(splitForSupplier([{ quantity: 5, plan: { c: 5 } }], stores)).toEqual({ columns: ['Люлин'], rows: [[5]] })
    expect(splitForSupplier([{ quantity: 5, plan: {} }], stores)).toBeNull()
  })

  const split: OrderDoc = {
    ...doc,
    split: { columns: ['Ботев', 'Офис'] },
    lines: [
      { ...doc.lines[0], split: [4, 6] },
      { ...doc.lines[1], split: [0, 24] },
    ],
  }

  it('orderText adds a block per store to pack', () => {
    const t = orderText(split)
    expect(t).toContain('Моля, опаковайте отделно за всеки обект:')
    expect(t).toContain('Ботев (4 бр.):\n- Боя за коса <тъмна> — 4 бр.')
    expect(t).toContain('Офис (30 бр.):\n- Боя за коса <тъмна> — 6 бр.\n- Паста за зъби — 24 бр.')
    expect(t).not.toContain('Ботев (4 бр.):\n- Паста')
    expect(orderText(doc)).not.toContain('опаковайте')
  })

  it('orderHtml adds a column per store, a total column and a total row', () => {
    const h = orderHtml(split)
    expect(h).toContain('>Ботев</th>')
    expect(h).toContain('>Офис</th>')
    expect(h).toContain('>Общо</th>')
    expect(h).not.toContain('>Брой</th>')
    expect(h).toContain('<strong>34</strong>')
    expect(h).toContain('<strong>30</strong>')
    expect(orderHtml(doc)).toContain('>Брой</th>')
  })
})

describe('orderTotals', () => {
  it('counts lines and units', () => {
    expect(orderTotals([{ quantity: 2 }, { quantity: 3 }])).toEqual({ lines: 2, units: 5 })
  })
})

describe('compareWithOrder', () => {
  const ordered = [
    { product_id: 'boq', name: 'Боя', quantity: 10 },
    { product_id: 'pasta', name: 'Паста', quantity: 24 },
    { product_id: 'shampoo', name: 'Шампоан', quantity: 5 },
  ]
  it('finds missing, extra and changed products', () => {
    const d = compareWithOrder(ordered, [
      { product_id: 'boq', name: 'Боя', quantity: 7 },
      { product_id: 'pasta', name: 'Паста', quantity: 24 },
      { product_id: 'krem', name: 'Крем', quantity: 3 },
    ])
    expect(d.missing.map(m => m.product_id)).toEqual(['shampoo'])
    expect(d.extra).toEqual([{ product_id: 'krem', name: 'Крем', quantity: 3 }])
    expect(d.changed).toEqual([{ product_id: 'boq', name: 'Боя', ordered: 10, came: 7 }])
    expect(d.same).toBe(false)
    expect(diffSentence(d)).toBe('1 продукт не е дошъл, 1 е с друго количество, 1 е дошъл извън поръчката.')
  })
  it('adds up a product spread over several delivery lines', () => {
    const d = compareWithOrder([ordered[0]], [
      { product_id: 'boq', name: 'Боя', quantity: 4 },
      { product_id: 'boq', name: 'Боя', quantity: 6 },
    ])
    expect(d.same).toBe(true)
    expect(diffSentence(d)).toBe('Всичко е като в поръчката.')
  })
  it('plural wording', () => {
    const d = compareWithOrder(ordered, [])
    expect(diffSentence(d)).toBe('3 продукта не са дошли.')
  })
})
