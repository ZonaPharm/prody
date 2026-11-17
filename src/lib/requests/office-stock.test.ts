import { describe, expect, it } from 'vitest'
import {
  batchesToOfficeStock,
  checkRequestItems,
  freeInOffice,
  getOfficeStock,
  notRequestable,
  notRequestableReason,
  requestProblem,
  toOfficeStockMap,
} from './office-stock'

const row = (product_id: string, on_hand: number, for_deliveries = 0, in_shipments = 0, free?: number) =>
  ({ product_id, on_hand, for_deliveries, in_shipments, free: free ?? Math.max(0, on_hand - for_deliveries - in_shipments) })

describe('office stock for "Заявки"', () => {
  it('reads office_free_stock rows and never goes below 0', () => {
    const m = toOfficeStockMap([row('a', 10, 4, 1), { product_id: 'b', on_hand: 2, for_deliveries: 5, in_shipments: 0 }])
    expect(m.a.free).toBe(5)
    expect(m.b.free).toBe(0)
    expect(freeInOffice(m, 'a')).toBe(5)
    expect(freeInOffice(m, 'missing')).toBe(0)
  })

  it('sums warehouse batches when there are no deliveries', () => {
    const m = batchesToOfficeStock([
      { product_id: 'a', quantity_remaining: 3 },
      { product_id: 'a', quantity_remaining: 2 },
      { product_id: 'b', quantity_remaining: 0 },
    ])
    expect(m.a).toEqual({ product_id: 'a', on_hand: 5, for_deliveries: 0, in_shipments: 0, free: 5 })
    expect(m.b).toBeUndefined()
  })

  it('says why a product cannot be asked for', () => {
    expect(notRequestable(row('a', 5))).toBeNull()
    expect(notRequestable(undefined)).toBe('none')
    expect(notRequestable(row('a', 0))).toBe('none')
    expect(notRequestable(row('a', 4, 0, 4))).toBe('packed')
    expect(notRequestable(row('a', 4, 4, 0))).toBe('kept')
    expect(notRequestableReason(undefined)).toBe('Няма го в Офис')
    expect(notRequestableReason(row('a', 1))).toBeNull()
  })

  it('lets a store ask up to what is free, the same product counted together', () => {
    const stock = toOfficeStockMap([row('a', 5), row('b', 3, 3)])
    const names = { a: 'Чай', b: 'Мед', c: 'Сироп' }
    expect(checkRequestItems([{ product_id: 'a', quantity: 5 }], stock, names)).toBeNull()
    expect(checkRequestItems([{ product_id: 'a', quantity: 3 }, { product_id: 'a', quantity: 3 }], stock, names))
      .toBe('„Чай“: в Офис може да се заявят най-много 5 бр.')
    expect(checkRequestItems([{ product_id: 'b', quantity: 1 }], stock, names))
      .toBe('„Мед“ не може да се заяви: в Офис е, но е за магазините по доставка или още чака етикет.')
    expect(checkRequestItems([{ product_id: 'c', quantity: 1 }], stock, names))
      .toBe('„Сироп“ не може да се заяви: няма го в Офис.')
  })
})

/** A tiny stand-in for the service-role client: rpc + from(table) with recorded filters. */
function fakeAdmin(opts: { rpc?: { data?: any[]; error?: any }; tables?: Record<string, any[]> }) {
  const calls: { table: string; filters: [string, ...any[]][] }[] = []
  const builder = (rows: any[] | null, error: any, rec?: { table: string; filters: [string, ...any[]][] }) => {
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (...a: any[]) => { rec?.filters.push(['eq', ...a]); return b },
      gt: (...a: any[]) => { rec?.filters.push(['gt', ...a]); return b },
      in: (...a: any[]) => { rec?.filters.push(['in', ...a]); return b },
      range: async () => ({ data: rows, error }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows, error }).then(res, rej),
    }
    return b
  }
  return {
    calls,
    rpc: (_name: string, _args: any) => builder(opts.rpc?.data ?? null, opts.rpc?.error ?? null),
    from: (table: string) => {
      const rec = { table, filters: [] as [string, ...any[]][] }
      calls.push(rec)
      return builder(opts.tables?.[table] ?? [], null, rec)
    },
  }
}

describe('getOfficeStock', () => {
  it('uses office_free_stock when it exists', async () => {
    const admin = fakeAdmin({ rpc: { data: [row('a', 9, 2, 1)] } })
    const m = await getOfficeStock(admin, null)
    expect(m.a.free).toBe(6)
    expect(admin.calls).toHaveLength(0)
  })

  it('falls back to the warehouse batches before the migration', async () => {
    const admin = fakeAdmin({
      rpc: { error: { code: 'PGRST202', message: 'Could not find the function' } },
      tables: {
        stores: [{ id: 'wh' }],
        stock_batches: [{ product_id: 'a', quantity_remaining: 4 }],
      },
    })
    const m = await getOfficeStock(admin, null)
    expect(m.a.free).toBe(4)
    const batches = admin.calls.find(c => c.table === 'stock_batches')!
    expect(batches.filters).toContainEqual(['in', 'store_id', ['wh']])
  })

  it('does not hide a real read failure', async () => {
    const admin = fakeAdmin({ rpc: { error: { code: '57014', message: 'timeout' } } })
    await expect(getOfficeStock(admin, null)).rejects.toMatchObject({ code: '57014' })
  })

  it('requestProblem names the product', async () => {
    const admin = fakeAdmin({ rpc: { data: [row('a', 2)] }, tables: { products: [{ id: 'a', name: 'Чай' }] } })
    expect(await requestProblem(admin, [{ product_id: 'a', quantity: 3 }])).toBe('„Чай“: в Офис може да се заявят най-много 2 бр.')
    expect(await requestProblem(admin, [{ product_id: 'a', quantity: 2 }])).toBeNull()
  })
})
