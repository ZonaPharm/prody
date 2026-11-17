import { describe, expect, it } from 'vitest'
import { ACTION_TOOLS, flatRow, keyWords, pickRows, productDiff } from './actions'
import { ASSISTANT_TOOLS, runTool, toolDefinitions } from './registry'
import { namesLoader, type ActContext } from './tools'
import { fakeDb, type Query } from './fake-db'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const SUP = '33333333-3333-4333-8333-333333333333'
const CONV = '44444444-4444-4444-8444-444444444444'

function setup(tables: Record<string, unknown[]>, act: Partial<ActContext> | null = {}) {
  const cards: any[] = []
  const f = fakeDb((q: Query) => {
    if (q.table === 'ai_actions') {
      const ins = q.calls.find(c => c[0] === 'insert')?.[1] as any
      return ins ? [{ id: 'card-1', ...ins, result: ins.result ?? null }] : []
    }
    return tables[q.table] ?? []
  })
  const ctx = {
    db: f.db,
    names: namesLoader(f.db),
    act: act === null ? undefined : {
      userId: 'u1', userName: 'Мира', conversationId: CONV, questionSeq: 3, deliveries: true,
      emit: (c: unknown) => cards.push(c), ...act,
    },
  }
  const run = async (name: string, input: unknown) => {
    const r = await runTool(ctx as any, name, input)
    return { ...r, out: JSON.parse(r.text) }
  }
  const inserted = () => f.queries.filter(q => q.table === 'ai_actions').map(q => q.calls.find(c => c[0] === 'insert')?.[1] as any).filter(Boolean)
  return { run, cards, queries: f.queries, inserted }
}

describe('tool list', () => {
  it('every tool name is unique and every schema is an object', () => {
    const defs = toolDefinitions()
    expect(new Set(defs.map(d => d.function.name)).size).toBe(defs.length)
    expect(defs.length).toBe(ASSISTANT_TOOLS.length)
    for (const d of defs) expect((d.function.parameters as any).type).toBe('object')
  })
  it('the proposal tools write only to ai_actions, never to the shop', () => {
    const src = ACTION_TOOLS.map(t => t.run.toString()).join('\n')
    expect(src).not.toMatch(/\.update\(|\.upsert\(|\.delete\(|\.rpc\(|email_settings/)
    const helpers = ACTION_TOOLS.map(t => t.run.toString()).join('\n')
    // The only insert goes through storeCard, which writes ai_actions.
    expect(helpers).not.toMatch(/from\('products'\)[^;]*\.insert\(/)
  })
})

describe('keyWords', () => {
  it('takes the two longest words, without doses', () => {
    expect(keyWords('Магнезий Цитрат 400mg 60 капс.')).toEqual(['Магнезий', 'Цитрат'])
    expect(keyWords('C 5 мг')).toEqual([])
  })
})

describe('pickRows / flatRow', () => {
  it('finds the first list of objects, or the one named', () => {
    const out = { period: 'x', groups: [{ key: 'a', revenue: 1 }], other: { rows: [{ n: 1 }] } }
    expect(pickRows(out)).toEqual([{ key: 'a', revenue: 1 }])
    expect(pickRows(out, 'other.rows')).toEqual([{ n: 1 }])
    expect(pickRows(out, 'nope')).toBeNull()
  })
  it('flattens nested values into columns', () => {
    expect(flatRow({ a: 1, b: { c: 'x' }, d: [1, 2], e: null })).toEqual({ a: 1, 'b.c': 'x', d: '1, 2', e: null })
  })
})

describe('productDiff', () => {
  it('keeps only real changes', () => {
    const cur = { name: 'А', price: 10, cost_price: null, barcode: '123', label_kind: 'full' }
    expect(productDiff(cur, { name: 'А', price: 12, cost_price: 5, barcode: ' 123 ', label_kind: 'price' }))
      .toEqual({ price: [10, 12], cost_price: [null, 5], label_kind: ['full', 'price'] })
  })
})

describe('propose_delivery_draft', () => {
  const products = [{ id: P1, name: 'Магнезий', price: 12, cost_price: 6, status: 'active' }]
  const suppliers = [{ id: SUP, name: 'Панацея', is_active: true }]

  it('stores a proposal, shows the card and changes nothing else', async () => {
    const t = setup({ products, suppliers })
    const r = await t.run('propose_delivery_draft', {
      supplier_id: SUP, document_number: '0000123',
      lines: [
        { product_id: P1, quantity: 10, unit_cost: 6.5, doc_text: 'Магнезий 400' },
        { new_product: { name: 'Цинк 25 мг', sale_price: 9.9 }, quantity: 5, unit_cost: 4 },
      ],
    })
    expect(r.isError).toBe(false)
    expect(r.out.told).toContain('Нищо не е записано')
    expect(t.cards).toHaveLength(1)
    const ins = t.inserted()[0]
    expect(ins).toMatchObject({ kind: 'delivery_draft', status: 'proposed', conversation_id: CONV, question_seq: 3, user_id: 'u1' })
    expect(ins.payload.lines[0]).toMatchObject({ product_id: P1, product_name: 'Магнезий', last_cost: 6, quantity: 10, unit_cost: 6.5 })
    expect(ins.payload.total).toBe(85)
    // Only reads and the one ai_actions insert.
    expect(t.queries.filter(q => q.table !== 'ai_actions').flatMap(q => q.calls.map(c => c[0])))
      .not.toContain('insert')
  })
  it('a line needs exactly one of product_id and new_product', async () => {
    const t = setup({ products, suppliers })
    const r = await t.run('propose_delivery_draft', { lines: [{ quantity: 1, unit_cost: 1 }] })
    expect(r.out.error).toContain('Ред 1')
    expect(t.cards).toHaveLength(0)
  })
  it('an unknown product is refused', async () => {
    const t = setup({ products: [], suppliers })
    const r = await t.run('propose_delivery_draft', { lines: [{ product_id: P2, quantity: 1, unit_cost: 1 }] })
    expect(r.out.error).toContain(P2)
  })
  it('not without deliveries switched on, and not outside the chat', async () => {
    expect((await setup({ products }, { deliveries: false }).run('propose_delivery_draft', { lines: [{ product_id: P1, quantity: 1, unit_cost: 1 }] })).out.error).toContain('не са включени')
    expect((await setup({ products }, null).run('propose_delivery_draft', { lines: [{ product_id: P1, quantity: 1, unit_cost: 1 }] })).out.error).toBeTruthy()
  })
})

describe('propose_product_change', () => {
  it('shows before and after for the fields that change', async () => {
    const t = setup({ products: [{ id: P1, name: 'Магнезий', price: 12, cost_price: 6, min_quantity: 5, status: 'active', updated_at: '2026-11-01T00:00:00Z' }] })
    const r = await t.run('propose_product_change', { product_id: P1, changes: { price: 12.9, min_quantity: 5 } })
    expect(r.out.changes).toEqual(['price'])
    expect(t.inserted()[0].payload).toMatchObject({ product_id: P1, updated_at: '2026-11-01T00:00:00Z', diff: { price: [12, 12.9] } })
  })
  it('nothing to change is said, not proposed', async () => {
    const t = setup({ products: [{ id: P1, name: 'Магнезий', price: 12 }] })
    expect((await t.run('propose_product_change', { product_id: P1, changes: { price: 12 } })).out.error).toContain('Нищо')
    expect(t.cards).toHaveLength(0)
  })
})

describe('propose_new_product', () => {
  it('refuses a barcode another product has', async () => {
    const t = setup({ products: [{ id: P1, name: 'Магнезий' }] })
    const r = await t.run('propose_new_product', { name: 'Нов', price: 5, barcode: '3800000000001' })
    expect(r.out.error).toBeTruthy()
    expect(t.cards).toHaveLength(0)
  })
})

describe('make_file', () => {
  it('takes the table from a read tool, so the numbers come from the database', async () => {
    const sales = [
      { id: 's1', quantity: 2, sale_price: 5, store_id: 'st1', sold_by: 'u', sale_date: '2026-11-10', product_id: P1, voided: false },
      { id: 's2', quantity: 1, sale_price: 10, store_id: 'st1', sold_by: 'u', sale_date: '2026-11-11', product_id: P1, voided: false },
    ]
    const t = setup({ sales, stores: [{ id: 'st1', name: 'Ботев' }], users: [], products: [{ id: P1, name: 'Магнезий' }] })
    const r = await t.run('make_file', {
      format: 'excel', title: 'Продажби',
      sections: [{ table: { from: { tool: 'sales_summary', input: { date_from: '2026-11-01', date_to: '2026-11-12', group_by: 'store' } }, rows_key: 'groups' } }],
    })
    expect(r.isError).toBe(false)
    const ins = t.inserted()[0]
    expect(ins).toMatchObject({ kind: 'excel', status: 'done' })
    const table = ins.payload.sections[0].table
    expect(table.source).toContain('sales_summary')
    expect(table.rows.length).toBeGreaterThan(0)
  })
  it('an unknown column is refused with the ones that exist', async () => {
    const t = setup({})
    const r = await t.run('make_file', { format: 'document', title: 'Т', sections: [{ table: { rows: [{ a: 1 }], columns: [{ key: 'b', title: 'Б' }] } }] })
    expect(r.out.error).toContain('Има: a')
  })
})
