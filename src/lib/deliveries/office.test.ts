import { describe, expect, it } from 'vitest'
import { officeRows, officeStockText } from './office'
import { officeAddSchema } from './schemas'

const P = (id: string, name: string) => ({ id, name, sku: null, price: '4.50', images: [] })
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('Office stock for "Добави от Офис"', () => {
  it('takes the numbers of office_free_stock; what is free comes first; no row = nothing in Офис', () => {
    const rows = officeRows(
      [P('a', 'Аспирин'), P('b', 'Билков чай'), P('c', 'Витамин')],
      [
        { product_id: 'a', on_hand: 5, for_deliveries: 2, in_shipments: 3, free: 0 },
        { product_id: 'b', on_hand: 4, for_deliveries: 0, in_shipments: 1, free: 3 },
      ],
    )
    expect(rows.map(r => [r.id, r.on_hand, r.bound, r.held, r.free])).toEqual([
      ['b', 4, 0, 1, 3],
      ['a', 5, 2, 3, 0],
      ['c', 0, 0, 0, 0],
    ])
    expect(rows[0].price).toBe(4.5)
  })

  it('reads in one line', () => {
    expect(officeStockText({ on_hand: 12, bound: 2, held: 4, free: 6 })).toBe('в Офис 12 бр. · 2 за доставки · 4 чакат в пратки · свободни 6')
    expect(officeStockText({ on_hand: 3, bound: 0, held: 0, free: 3 })).toBe('в Офис 3 бр. · свободни 3')
    expect(officeStockText({ on_hand: 0, bound: 0, held: 0, free: 0 })).toBe('няма в Офис')
  })

  it('the request: a store, at least one product, each once, whole units from 1', () => {
    expect(officeAddSchema.safeParse({ store_id: A, lines: [{ product_id: B, qty: 2 }] }).success).toBe(true)
    expect(officeAddSchema.safeParse({ trip_id: null, store_id: A, lines: [{ product_id: B, qty: 2 }] }).success).toBe(true)
    expect(officeAddSchema.safeParse({ store_id: A, lines: [] }).success).toBe(false)
    expect(officeAddSchema.safeParse({ store_id: A, lines: [{ product_id: B, qty: 0 }] }).success).toBe(false)
    expect(officeAddSchema.safeParse({ store_id: A, lines: [{ product_id: B, qty: 1.5 }] }).success).toBe(false)
    expect(officeAddSchema.safeParse({ store_id: A, lines: [{ product_id: B, qty: 1 }, { product_id: B, qty: 2 }] }).success).toBe(false)
  })
})
