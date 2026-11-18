import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/deliveries/products/[id]: the product the delivery's "Нов продукт"
// form has just saved, shaped as a delivery line needs it.

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true }
const PRODUCT = '44444444-4444-4444-8444-444444444444'
const SUPPLIER = '66666666-6666-4666-8666-666666666666'

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  product: null as null | Record<string, unknown>,
  productReads: 0,
}))

function query(result: () => unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'or', 'in', 'neq', 'not']) q[m] = () => q
  q.single = () => Promise.resolve(result())
  q.maybeSingle = () => Promise.resolve(result())
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko)
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      if (table === 'users') return query(() => ({ data: mocks.profile }))
      if (table === 'products') return query(() => { mocks.productReads++; return { data: mocks.product, error: null } })
      if (table === 'delivery_items') return query(() => ({ data: [], error: null }))
      if (table === 'suppliers') return query(() => ({ data: [{ id: SUPPLIER, name: 'Панацея', is_active: true }], error: null }))
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { GET } from './route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const req = {} as Request

describe('GET /api/deliveries/products/[id]', () => {
  beforeEach(() => {
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN }
    mocks.productReads = 0
    mocks.product = {
      id: PRODUCT, name: 'Крем', sku: null, status: 'active', price: '8.90', cost_price: '4.20',
      source: 'Панацея', needs_label: true, label_kind: 'full', quantity_on_hand: 0, images: [],
    }
  })

  it('gives the new product with the supplier from "Източник" and the cost from "Доставна цена"', async () => {
    const res = await GET(req, params(PRODUCT))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: PRODUCT, name: 'Крем', price: 8.9, label_kind: 'full' })
    expect(body.suggested).toEqual({ supplier_id: SUPPLIER, unit_cost: 4.2, pack_size: 1 })
  })

  it('only for an admin', async () => {
    mocks.profile = { ...ADMIN, role: 'seller', roles: ['office'] }
    expect((await GET(req, params(PRODUCT))).status).toBe(403)
    mocks.user = null
    expect((await GET(req, params(PRODUCT))).status).toBe(401)
    expect(mocks.productReads).toBe(0)
  })

  it('404 for an id that is not a uuid or a product that is not there', async () => {
    expect((await GET(req, params('abc'))).status).toBe(404)
    expect(mocks.productReads).toBe(0)
    mocks.product = null
    expect((await GET(req, params(PRODUCT))).status).toBe(404)
  })
})
