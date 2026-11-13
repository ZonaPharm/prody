import { describe, expect, it } from 'vitest'
import { confirmSchemas, execute, withinProposal } from './execute'
import { fakeDb, type Query } from './fake-db'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const SUP = '33333333-3333-4333-8333-333333333333'
const actor = { id: 'u1', name: 'Мира' }

const draftProposal = {
  supplier_id: SUP,
  lines: [
    { product_id: P1, product_name: 'Магнезий', quantity: 10, unit_cost: 6 },
    { product_id: null, new_product: { name: 'Цинк', sale_price: 9.9 }, quantity: 5, unit_cost: 4 },
  ],
}

describe('withinProposal', () => {
  it('a delivery keeps to the proposed products and supplier', () => {
    const ok = confirmSchemas.delivery_draft.parse({ supplier_id: SUP, lines: [{ product_id: P1, quantity: 3, unit_cost: 5 }] })
    expect(withinProposal('delivery_draft', draftProposal, ok)).toBeNull()
    const other = confirmSchemas.delivery_draft.parse({ supplier_id: SUP, lines: [{ product_id: P2, quantity: 3, unit_cost: 5 }] })
    expect(withinProposal('delivery_draft', draftProposal, other)).toContain('не беше в предложението')
    const sup = confirmSchemas.delivery_draft.parse({ supplier_id: null, lines: [{ product_id: P1, quantity: 3, unit_cost: 5 }] })
    expect(withinProposal('delivery_draft', draftProposal, sup)).toContain('Доставчикът')
  })
  it('a product change keeps to the proposed fields', () => {
    const p = { product_id: P1, diff: { price: [10, 12] } }
    expect(withinProposal('product_update', p, { after: { price: 11 } })).toBeNull()
    expect(withinProposal('product_update', p, { after: { price: 11, name: 'X' } })).toContain('Поле')
    expect(withinProposal('product_update', p, { after: {} })).toContain('Не е избрана')
  })
  it('quantities must be whole and above zero', () => {
    expect(confirmSchemas.delivery_draft.safeParse({ lines: [{ product_id: P1, quantity: 0, unit_cost: 1 }] }).success).toBe(false)
    expect(confirmSchemas.supplier_order.safeParse({ supplier_id: SUP, lines: [{ product_id: P1, quantity: 1.5 }] }).success).toBe(false)
  })
})

describe('execute', () => {
  const card = (kind: any, payload: any) => ({ id: 'a1', kind, title: 't', status: 'proposed' as const, payload, result: null })

  it('a delivery draft makes the new products first, then one save_delivery_draft as this person', async () => {
    const f = fakeDb((q: Query) => {
      if (q.table === 'suppliers') return [{ name: 'Панацея' }]
      if (q.table === 'products') return [{ id: P2 }]
      if (q.table === 'rpc:save_delivery_draft') return [{ id: 'd1', updated_at: 'x', items: [] }]
      return []
    })
    const edited = confirmSchemas.delivery_draft.parse({ supplier_id: SUP, document_number: '123', lines: [
      { product_id: P1, quantity: 10, unit_cost: 6 },
      { new_product: { name: 'Цинк', sale_price: 9.9 }, quantity: 5, unit_cost: 4 },
    ] })
    const r = await execute(f.db, actor, card('delivery_draft', draftProposal), 'delivery_draft', edited)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result.url).toBe('/deliveries/d1')
    const insert = f.queries.find(q => q.table === 'products')!.calls.find(c => c[0] === 'insert')![1] as any
    expect(insert).toMatchObject({ name: 'Цинк', price: 9.9, quantity_on_hand: 0, source: 'Панацея', label_kind: 'full' })
    const rpc = f.queries.find(q => q.table === 'rpc:save_delivery_draft')!.calls[0][1] as any
    expect(rpc.p_user).toBe('u1')
    expect(rpc.p_delivery_id).toBeNull()
    expect(rpc.p_draft.order_ref).toBe('123')
    expect(rpc.p_draft.items.map((i: any) => [i.product_id, i.quantity, i.unit_cost, i.supplier_id])).toEqual([[P1, 10, 6, SUP], [P2, 5, 4, SUP]])
  })

  it('when the draft fails after new products were made, the card keeps them (no second copy on retry)', async () => {
    const f = fakeDb((q: Query) => {
      if (q.table === 'products') return [{ id: P2 }]
      if (q.table === 'rpc:save_delivery_draft') return { error: { message: 'Продукт от черновата не е намерен' } }
      return []
    })
    const edited = confirmSchemas.delivery_draft.parse({ supplier_id: SUP, lines: [{ new_product: { name: 'Цинк', sale_price: 9.9 }, quantity: 5, unit_cost: 4 }] })
    const r = await execute(f.db, actor, card('delivery_draft', draftProposal), 'delivery_draft', edited)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('вече са създадени')
      expect(r.proposal.lines[0]).toMatchObject({ product_id: P2, new_product: null })
    }
  })

  it('a product change writes only if nobody changed the product since', async () => {
    const f = fakeDb(() => [])
    const r = await execute(f.db, actor, card('product_update', { product_id: P1, product_name: 'М', updated_at: '2026-11-01T00:00:00Z', diff: { price: [10, 12] } }),
      'product_update', { after: { price: 12 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('променен след предложението')
    const calls = f.queries[0].calls
    expect(calls).toContainEqual(['update', { price: 12 }])
    expect(calls).toContainEqual(['eq', 'updated_at', '2026-11-01T00:00:00Z'])
  })

  it('a label change keeps needs_label in step', async () => {
    const f = fakeDb(q => (q.table === 'products' ? [{ id: P1 }] : []))
    const r = await execute(f.db, actor, card('product_update', { product_id: P1, product_name: 'М', diff: { label_kind: ['full', 'price'] } }),
      'product_update', { after: { label_kind: 'price' } })
    expect(r.ok).toBe(true)
    expect(f.queries[0].calls).toContainEqual(['update', { label_kind: 'price', needs_label: false }])
  })
})
