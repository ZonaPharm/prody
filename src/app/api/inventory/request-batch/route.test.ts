import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Заявки": a seller asks only for what Офис can send now; an admin may still
// write a request for anything. A failed stock read never lets a request through.

const SELLER = { id: '22222222-2222-4222-8222-222222222222' }
const STORE = '55555555-5555-4555-8555-555555555555'
const P = '66666666-6666-4666-8666-666666666666'

const mocks = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  requestProblem: vi.fn(),
  inserts: [] as unknown[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: SELLER } }) },
    from: (table: string) => {
      const q: Record<string, any> = {}
      q.select = () => q
      q.eq = () => q
      q.single = () => Promise.resolve(table === 'users' ? { data: mocks.profile } : { data: { id: 'r1' }, error: null })
      q.insert = (row: unknown) => { mocks.inserts.push(row); return q }
      return q
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}))
vi.mock('@/lib/audit', () => ({ logAction: vi.fn() }))
vi.mock('@/lib/requests/office-stock', () => ({ requestProblem: mocks.requestProblem }))

import { POST } from './route'

const post = (body: unknown) => POST(new Request('http://x/api/inventory/request-batch', {
  method: 'POST', body: JSON.stringify(body),
}) as any)

beforeEach(() => {
  mocks.inserts = []
  mocks.requestProblem.mockReset()
  mocks.profile = { store_id: STORE, role: 'seller' }
})

describe('POST /api/inventory/request-batch', () => {
  it('refuses what Офис cannot send, with the reason', async () => {
    mocks.requestProblem.mockResolvedValue('„Чай“ не може да се заяви: няма го в Офис.')
    const res = await post({ items: [{ product_id: P, quantity: 2 }] })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('няма го в Офис')
    expect(mocks.inserts).toHaveLength(0)
  })

  it('writes the request when Офис has it free', async () => {
    mocks.requestProblem.mockResolvedValue(null)
    const res = await post({ items: [{ product_id: P, quantity: 2 }] })
    expect(res.status).toBe(200)
    expect(mocks.requestProblem).toHaveBeenCalledWith(expect.anything(), [{ product_id: P, quantity: 2 }])
    expect(mocks.inserts).toEqual([expect.objectContaining({ product_id: P, store_id: STORE, requested_qty: 2 })])
  })

  it('does not let a request through when the stock read fails', async () => {
    mocks.requestProblem.mockRejectedValue(new Error('timeout'))
    const res = await post({ items: [{ product_id: P, quantity: 1 }] })
    expect(res.status).toBe(503)
    expect(mocks.inserts).toHaveLength(0)
  })

  it('lets an admin write a request for anything', async () => {
    mocks.profile = { store_id: null, role: 'admin' }
    const res = await post({ store_id: STORE, items: [{ product_id: P, quantity: 1 }] })
    expect(res.status).toBe(200)
    expect(mocks.requestProblem).not.toHaveBeenCalled()
  })

  it('refuses a zero, negative or broken quantity', async () => {
    for (const quantity of [0, -1, 1.5, 'x']) {
      const res = await post({ items: [{ product_id: P, quantity }] })
      expect(res.status).toBe(400)
    }
    expect(mocks.inserts).toHaveLength(0)
  })
})
