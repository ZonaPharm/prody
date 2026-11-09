import { beforeEach, describe, expect, it, vi } from 'vitest'

// A query builder that accepts any chain (.select().eq().single() …) and
// resolves to the given result, which is all the route needs from Supabase.
function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gt', 'order', 'insert']) q[m] = () => q
  q.single = () => Promise.resolve(result)
  q.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail)
  return q
}

const mocks = vi.hoisted(() => ({
  insertedSales: [] as { id: string; product_id: string; quantity: number }[],
  adminRpc: vi.fn(),
  executeSaleFIFO: vi.fn(),
  getFIFOBatches: vi.fn(),
  logAction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'seller-1', email: 'seller@example.test' } } }) },
    from: (table: string) => {
      if (table === 'users') return query({ data: { role: 'seller', store_id: 'store-1', display_name: 'Продавач' } })
      if (table === 'stores') return query({ data: { id: 'store-1' } })
      if (table === 'sales') return query({ data: mocks.insertedSales, error: null })
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'products') return query({ data: { name: 'Продукт' } })
      throw new Error(`unexpected admin table ${table}`)
    },
    rpc: mocks.adminRpc,
  }),
}))
vi.mock('@/lib/inventory', () => ({
  executeSaleFIFO: mocks.executeSaleFIFO,
  getFIFOBatches: mocks.getFIFOBatches,
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { POST } from './route'

const items = [
  { product_id: 'product-a', quantity: 2, unit_price: 10 },
  { product_id: 'product-b', quantity: 1, unit_price: 4.5 },
]

function sell(body: unknown) {
  return POST({ json: async () => body } as never)
}

describe('POST /api/sales/group', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertedSales = [
      { id: 'sale-a', product_id: 'product-a', quantity: 2 },
      { id: 'sale-b', product_id: 'product-b', quantity: 1 },
    ]
    mocks.getFIFOBatches.mockResolvedValue({ batches: [], total: 100 })
    mocks.executeSaleFIFO.mockResolvedValue(undefined)
    mocks.adminRpc.mockResolvedValue({ data: null, error: null })
  })

  it('deducts each item through executeSaleFIFO, against its own sale row', async () => {
    const res = await sell({ store_id: 'store-1', items, payment_method: 'card' })

    expect(res.status).toBe(200)
    expect(mocks.executeSaleFIFO).toHaveBeenCalledTimes(2)
    expect(mocks.executeSaleFIFO).toHaveBeenNthCalledWith(1, 'product-a', 'store-1', 2, 10, 'sale-a', 'seller-1')
    expect(mocks.executeSaleFIFO).toHaveBeenNthCalledWith(2, 'product-b', 'store-1', 1, 4.5, 'sale-b', 'seller-1')
  })

  // The counter used to be a separate call made first; when it failed the
  // batches were skipped too (a sale on 12 September 2026 at Заимов). The
  // counter now moves inside the same database call as the batches.
  it('makes no separate quantity_on_hand call that could fail on its own', async () => {
    await sell({ store_id: 'store-1', items })

    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('still deducts the other items when one fails, and records the failure', async () => {
    mocks.executeSaleFIFO.mockImplementation(async (productId: string) => {
      if (productId === 'product-a') throw new Error('Недостатъчна наличност: липсват 1 бр.')
    })

    const res = await sell({ store_id: 'store-1', items })

    expect(res.status).toBe(200)
    expect(mocks.executeSaleFIFO).toHaveBeenCalledTimes(2)
    const failure = mocks.logAction.mock.calls.find(([entry]) => entry.action === 'sale_fifo_failed')
    expect(failure?.[0].details).toContain('product-a')
    expect(failure?.[0].details).not.toContain('product-b')
  })

  it('logs no failure when every item is deducted', async () => {
    await sell({ store_id: 'store-1', items })

    const actions = mocks.logAction.mock.calls.map(([entry]) => entry.action)
    expect(actions).toEqual(['sale_group'])
  })
})
