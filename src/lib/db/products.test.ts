import { beforeEach, describe, expect, it, vi } from 'vitest'

// Records every call on the products query and resolves to the given rows.
const db = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  rows: [] as unknown[],
  tables: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    from: (table: string) => {
      db.tables.push(table)
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gt', 'is', 'ilike', 'in', 'order', 'limit', 'range']) {
        q[m] = (...args: unknown[]) => { db.calls.push([m, ...args]); return q }
      }
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: db.rows, error: null }).then(ok)
      return q
    },
  }),
}))

import { getProducts } from './products'

const called = (method: string) => db.calls.filter(([m]) => m === method).map(([, ...args]) => args)

describe('getProducts store filter', () => {
  beforeEach(() => {
    db.calls = []
    db.tables = []
    db.rows = [{ id: 'p1', name: 'Продукт', in_store: [{ id: 'b1' }, { id: 'b2' }] }]
  })

  // Sending the store's product ids back in .in('id', …) put them all in the
  // URL, and past about 398 (Ботев reached 391) the catalogue came back empty.
  it('filters in the database instead of sending product ids in the URL', async () => {
    await getProducts({ storeId: 'store-1' })

    expect(db.tables).toEqual(['products'])
    expect(called('in')).toEqual([])
    expect(called('select')[0][0]).toContain('in_store:stock_batches!inner(id)')
    expect(called('eq')).toContainEqual(['in_store.store_id', 'store-1'])
    expect(called('gt')).toContainEqual(['in_store.quantity_remaining', 0])
  })

  it('returns each product once, without the joined batches', async () => {
    const products = await getProducts({ storeId: 'store-1' })

    expect(products).toEqual([{ id: 'p1', name: 'Продукт' }])
  })

  it('does not join the batches when no store is chosen', async () => {
    db.rows = [{ id: 'p1', name: 'Продукт' }]

    const products = await getProducts({})

    expect(called('select')[0][0]).not.toContain('stock_batches')
    expect(called('eq')).toEqual([['status', 'active']])
    expect(products).toEqual([{ id: 'p1', name: 'Продукт' }])
  })
})
