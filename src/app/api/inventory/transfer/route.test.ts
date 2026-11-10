import { beforeEach, describe, expect, it, vi } from 'vitest'

function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) q[m] = () => q
  q.single = () => Promise.resolve(result)
  return q
}

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
  logAction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    from: (table: string) => {
      if (table === 'users') return query({ data: { role: mocks.role } })
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc, from: mocks.adminFrom }),
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { POST } from './route'

const body = { product_id: 'product-a', from_store_id: 'office', to_store_id: 'store-1', quantity: 5 }

function transfer(b: unknown) {
  return POST({ json: async () => b } as never)
}

describe('POST /api/inventory/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.role = 'admin'
    mocks.adminRpc.mockResolvedValue({ data: 2, error: null })
  })

  it('moves the stock with one transfer_stock call and answers as before', async () => {
    const res = await transfer(body)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, transferred: 2 })
    expect(mocks.adminRpc).toHaveBeenCalledTimes(1)
    expect(mocks.adminRpc).toHaveBeenCalledWith('transfer_stock', {
      p_product_id: 'product-a',
      p_from_store: 'office',
      p_to_store: 'store-1',
      p_quantity: 5,
      p_user: 'admin-1',
      p_notes: null,
    })
    // Nothing is read or written around the function any more.
    expect(mocks.adminFrom).not.toHaveBeenCalled()
    expect(mocks.logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'transfer', userId: 'admin-1', details: 'office → store-1, 5 бр.' }),
      expect.anything(),
    )
  })

  it('passes a rule the function raised to the screen as 400', async () => {
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Недостатъчна наличност за "Продукт": налични 3, искани 5' },
    })

    const res = await transfer(body)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Недостатъчна наличност за "Продукт": налични 3, искани 5' })
    expect(mocks.logAction).not.toHaveBeenCalled()
  })

  it('answers 500 when the function itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.adminRpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.transfer_stock' },
    })

    const res = await transfer(body)

    expect(res.status).toBe(500)
    expect(mocks.logAction).not.toHaveBeenCalled()
  })

  it('still refuses a seller and an incomplete request before touching stock', async () => {
    mocks.role = 'seller'
    expect((await transfer(body)).status).toBe(403)

    mocks.role = 'admin'
    expect((await transfer({ ...body, quantity: 0 })).status).toBe(400)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })
})
