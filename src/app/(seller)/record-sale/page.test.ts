import { beforeEach, describe, expect, it, vi } from 'vitest'

// A fake admin client that behaves like PostgREST where it matters here: a
// plain request returns at most 1000 rows, without saying so, and .range()
// returns the slice asked for.
const MAX_ROWS = 1000

const db = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  failing: new Set<string>(),
}))

function builder(table: string) {
  const eqs: Record<string, unknown> = {}
  let range: [number, number] | null = null
  let limit: number | null = null
  const result = () => {
    if (db.failing.has(table)) return { data: null, error: { message: `${table} failed` } }
    // The seller's own recent sales are a separate, small query.
    if (table === 'sales' && 'sold_by' in eqs) return { data: [], error: null }
    const rows = db.tables[table] || []
    const [from, to] = range ?? [0, (limit ?? MAX_ROWS) - 1]
    return { data: rows.slice(from, Math.min(to, from + MAX_ROWS - 1) + 1), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (col: string, val: unknown) => { eqs[col] = val; return q },
    gt: () => q,
    gte: () => q,
    order: () => q,
    limit: (n: number) => { limit = n; return q },
    range: (from: number, to: number) => { range = [from, to]; return q },
    then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail),
  }
  return q
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: builder }) }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ id: 'seller-1', role: 'seller', store_id: 'store-1' }),
  getEffectiveRole: async () => 'seller',
}))
vi.mock('@/components/pos/pos-client', () => ({ POSClient: () => null }))

import RecordSalePage from './page'

type Props = {
  products: { id: string; image_url: string | null; quantity_on_hand: number }[]
  outOfStock: { id: string }[]
}

async function render(): Promise<Props> {
  const element = await RecordSalePage({ searchParams: Promise.resolve({}) })
  return (element as unknown as { props: Props }).props
}

const id = (n: number) => `p${String(n).padStart(4, '0')}`
const N = 1200

describe('record-sale page past 1000 rows', () => {
  beforeEach(() => {
    db.failing.clear()
    db.tables = {
      stores: [{ id: 'store-1', name: 'Ботев' }],
      categories: [],
      // 1200 active products, each with one batch in the store and a picture.
      products: Array.from({ length: N }, (_, i) => ({ id: id(i), name: `Продукт ${id(i)}`, price: 1, quantity_on_hand: 2, category_id: null })),
      stock_batches: Array.from({ length: N }, (_, i) => ({ product_id: id(i), quantity_remaining: 2 })),
      product_images: Array.from({ length: N }, (_, i) => ({ product_id: id(i), url: `https://img/${id(i)}.jpg` })),
      // 1500 sales: 500 of p0001, 400 of p0002, then 600 of p1199. Cut at
      // 1000 rows, p1199 would count 100 and sink below the other two.
      sales: [
        ...Array.from({ length: 500 }, () => ({ product_id: id(1) })),
        ...Array.from({ length: 400 }, () => ({ product_id: id(2) })),
        ...Array.from({ length: 600 }, () => ({ product_id: id(N - 1) })),
      ],
    }
  })

  it('offers every product with stock, not just the first 1000', async () => {
    const { products, outOfStock } = await render()

    expect(products).toHaveLength(N)
    expect(outOfStock).toHaveLength(0)
  })

  it('orders by every sale in the 90 days, not the first 1000', async () => {
    const { products } = await render()

    expect(products.slice(0, 3).map(p => p.id)).toEqual([id(N - 1), id(1), id(2)])
  })

  it('finds the picture of a product past the 1000th image', async () => {
    const { products } = await render()

    expect(products.find(p => p.id === id(N - 1))?.image_url).toBe(`https://img/${id(N - 1)}.jpg`)
  })

  it('still sells, without pictures, when the images cannot be read', async () => {
    db.failing.add('product_images')

    const { products } = await render()

    expect(products).toHaveLength(N)
    expect(products.every(p => p.image_url === null)).toBe(true)
  })

  it('still sells, in name order, when the sales counts cannot be read', async () => {
    db.failing.add('sales')

    const { products } = await render()

    expect(products).toHaveLength(N)
    expect(products[0].id).toBe(id(0))
  })
})
