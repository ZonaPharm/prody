import { beforeEach, describe, expect, it, vi } from 'vitest'

const admin = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(() => {
    throw new Error('executeSaleFIFO must not read or write tables itself')
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }))

import { executeSaleFIFO } from './inventory'

describe('executeSaleFIFO', () => {
  beforeEach(() => {
    admin.rpc.mockReset()
    admin.from.mockClear()
  })

  it('deducts the sale in one database call: batches, movements and counter together', async () => {
    admin.rpc.mockResolvedValue({ data: 2, error: null })

    await executeSaleFIFO('product-1', 'store-1', 3, 12.5, 'sale-1', 'user-1')

    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('sell_from_batches', {
      p_product_id: 'product-1',
      p_store_id: 'store-1',
      p_quantity: 3,
      p_unit_price: 12.5,
      p_sale_id: 'sale-1',
      p_user_id: 'user-1',
    })
  })

  // Reading quantity_remaining and writing it back from here is the race that
  // lost a deduction whenever two sales of a product overlapped.
  it('never touches the batches or movements from the app', async () => {
    admin.rpc.mockResolvedValue({ data: 1, error: null })

    await executeSaleFIFO('product-1', 'store-1', 1, 1, 'sale-1', 'user-1')

    expect(admin.from).not.toHaveBeenCalled()
  })

  it('fails loudly when the store holds too little', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Недостатъчна наличност: липсват 2 бр.' } })

    await expect(executeSaleFIFO('product-1', 'store-1', 5, 1, 'sale-1', 'user-1'))
      .rejects.toThrow('Недостатъчна наличност: липсват 2 бр.')
  })

  // No silent fallback to the old read-then-write path: the migration goes to
  // production before this code does.
  it('fails loudly when the database function is missing', async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.sell_from_batches' } })

    await expect(executeSaleFIFO('product-1', 'store-1', 1, 1, 'sale-1', 'user-1'))
      .rejects.toThrow('sell_from_batches')
    expect(admin.from).not.toHaveBeenCalled()
  })
})
