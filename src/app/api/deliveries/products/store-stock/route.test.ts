import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/deliveries/products/store-stock: what each store holds now, for the
// distribution under a delivery line. Admin only; reads with the admin's session.

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true }
const P1 = '44444444-4444-4444-8444-444444444444'
const P2 = '44444444-4444-4444-8444-444444444445'
const S1 = '55555555-5555-4555-8555-555555555555'
const OFFICE = '66666666-6666-4666-8666-666666666666'

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  batches: [] as Record<string, unknown>[],
  batchesError: null as unknown,
  products: [] as Record<string, unknown>[],
  calls: [] as { table: string; filters: unknown[][] }[],
}))

function query(table: string, result: () => { data: unknown; error: unknown }) {
  const call = { table, filters: [] as unknown[][] }
  mocks.calls.push(call)
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'gt']) q[m] = (...args: unknown[]) => { call.filters.push([m, ...args]); return q }
  q.range = (from: number, to: number) => {
    const r = result()
    return Promise.resolve({ ...r, data: Array.isArray(r.data) ? r.data.slice(from, to + 1) : r.data })
  }
  q.single = () => Promise.resolve(result())
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      if (table === 'users') return query(table, () => ({ data: mocks.profile, error: null }))
      if (table === 'stock_batches') return query(table, () => ({ data: mocks.batches, error: mocks.batchesError }))
      if (table === 'products') return query(table, () => ({ data: mocks.products, error: null }))
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { GET } from './route'

const get = (ids: string) => GET(new Request(`http://x/api/deliveries/products/store-stock?ids=${ids}`))

describe('GET store-stock', () => {
  beforeEach(() => {
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN }
    mocks.batches = []
    mocks.batchesError = null
    mocks.products = []
    mocks.calls = []
  })
  afterEach(() => vi.unstubAllEnvs())

  it('401 without a session, 403 for a seller and for Офис', async () => {
    mocks.user = null
    expect((await get(P1)).status).toBe(401)
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN, role: 'seller' }
    expect((await get(P1)).status).toBe(403)
    mocks.profile = { ...ADMIN, role: 'seller', roles: ['office'] }
    expect((await get(P1)).status).toBe(403)
    expect(mocks.calls.some(c => c.table === 'stock_batches')).toBe(false)
  })

  it('sums the batches per store and gives the minimum', async () => {
    mocks.batches = [
      { id: 'b1', product_id: P1, store_id: S1, quantity_remaining: 2 },
      { id: 'b2', product_id: P1, store_id: S1, quantity_remaining: 3 },
      { id: 'b3', product_id: P1, store_id: OFFICE, quantity_remaining: 10 },
    ]
    mocks.products = [{ id: P1, min_quantity: 5 }, { id: P2, min_quantity: null }]
    const res = await get(`${P1},${P2},junk`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      stock: { [P1]: { [S1]: 5, [OFFICE]: 10 }, [P2]: {} },
      min: { [P1]: 5, [P2]: null },
    })
    const batches = mocks.calls.find(c => c.table === 'stock_batches')!
    expect(batches.filters).toContainEqual(['in', 'product_id', [P1, P2]])
    expect(batches.filters).toContainEqual(['gt', 'quantity_remaining', 0])
  })

  it('reads past the 1000-row cap', async () => {
    mocks.batches = Array.from({ length: 1500 }, (_, i) => ({ id: `b${i}`, product_id: P1, store_id: S1, quantity_remaining: 1 }))
    const res = await get(P1)
    expect((await res.json()).stock[P1][S1]).toBe(1500)
  })

  it('nothing asked: nothing read', async () => {
    const res = await get('')
    expect(await res.json()).toEqual({ stock: {}, min: {} })
    expect(mocks.calls.some(c => c.table === 'stock_batches')).toBe(false)
  })

  it('500 in Bulgarian when the database fails', async () => {
    mocks.batchesError = { message: 'boom' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get(P1)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Наличностите по обекти не можаха да се заредят')
  })
})
