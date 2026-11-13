import { describe, expect, it } from 'vitest'
import { ASSISTANT_TOOLS, namesLoader, parseNumber, runTool, toolDefinitions } from './tools'
import { fakeDb } from './fake-db'

const STORES = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ботев' }]
const USERS = [{ id: '22222222-2222-4222-8222-222222222222', display_name: 'Мира', email: 'mira@example.com', role: 'admin', roles: ['admin'], store_id: null, is_active: true }]

function ctxWith(tables: Record<string, unknown[]>) {
  const f = fakeDb(q => tables[q.table] ?? [])
  return { ...f, ctx: { db: f.db, names: namesLoader(f.db) } }
}

describe('tool definitions', () => {
  it('every tool has a unique name, a description and an object schema without $schema', () => {
    const defs = toolDefinitions()
    expect(new Set(defs.map(d => d.function.name)).size).toBe(defs.length)
    for (const d of defs) {
      expect(d.type).toBe('function')
      expect(d.function.description.length).toBeGreaterThan(20)
      expect((d.function.parameters as any).type).toBe('object')
      expect((d.function.parameters as any).$schema).toBeUndefined()
    }
  })
  it('no tool reads the mail settings, the auth schema or writes anything', () => {
    // The tools only call select-style methods; a write would show up here.
    const src = ASSISTANT_TOOLS.map(t => t.run.toString()).join('\n')
    expect(src).not.toMatch(/email_settings|auth\.|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
  })
})

describe('runTool', () => {
  it('an unknown tool is an error result, not a crash', async () => {
    const { ctx } = ctxWith({})
    const r = await runTool(ctx, 'drop_everything', {})
    expect(r.isError).toBe(true)
  })
  it('bad parameters are refused before any query', async () => {
    const { ctx, queries } = ctxWith({})
    const r = await runTool(ctx, 'product_stock', { product_id: 'not-a-uuid' })
    expect(r.isError).toBe(true)
    expect(queries).toHaveLength(0)
  })
  it('a failed read becomes {"error"} for the model', async () => {
    const f = fakeDb(() => ({ error: { code: 'PGRST205', message: 'missing' } }))
    const r = await runTool({ db: f.db, names: namesLoader(f.db) }, 'list_deliveries', {})
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.text).error).toContain('миграцията')
  })
})

describe('people_and_stores', () => {
  it('never hands e-mail addresses to the model', async () => {
    const { ctx } = ctxWith({ stores: STORES, users: USERS })
    const r = await runTool(ctx, 'people_and_stores', {})
    expect(r.text).not.toContain('mira@example.com')
    expect(JSON.parse(r.text).people[0]).toMatchObject({ name: 'Мира', roles: 'Администратор', active: true })
  })
})

describe('find_products', () => {
  it('cleans the search term before it goes into the filter', async () => {
    const { ctx, queries } = ctxWith({ products: [] })
    await runTool(ctx, 'find_products', { query: 'Витамин C (1000),' })
    const or = queries[0].calls.find(c => c[0] === 'or')
    expect(or?.[1]).toBe('name.ilike.%Витамин C 1000%,sku.eq.Витамин C 1000,barcode.eq.Витамин C 1000,internal_barcode.eq.Витамин C 1000')
  })
})

describe('sales_summary', () => {
  it('totals only non-voided lines, groups by store with names, reports voided apart', async () => {
    const s = STORES[0].id
    const f = fakeDb(q => {
      if (q.table === 'stores') return STORES
      if (q.table === 'users') return USERS
      const voided = q.calls.some(c => c[0] === 'eq' && c[1] === 'voided' && c[2] === true)
      return voided
        ? [{ quantity: 1, sale_price: '9.99' }]
        : [
            { quantity: 2, sale_price: '10', sale_date: '2026-11-10', store_id: s, sold_by: USERS[0].id, product_id: 'p', payment_method: 'cash' },
            { quantity: 1, sale_price: '5', sale_date: '2026-11-11', store_id: s, sold_by: USERS[0].id, product_id: 'p', payment_method: 'card' },
          ]
    })
    const r = await runTool({ db: f.db, names: namesLoader(f.db) }, 'sales_summary', {
      date_from: '2026-11-01', date_to: '2026-11-13', group_by: 'store',
    })
    const out = JSON.parse(r.text)
    expect(out.revenue).toBe(25)
    expect(out.units).toBe(3)
    expect(out.voided).toEqual({ lines: 1, revenue: 9.99 })
    expect(out.groups).toEqual([{ key: s, label: 'Ботев', revenue: 25, units: 3, lines: 2 }])
    const sales = f.queries.filter(q => q.table === 'sales')
    expect(sales[0].calls).toContainEqual(['gte', 'sale_date', '2026-11-01'])
    expect(sales[0].calls).toContainEqual(['lte', 'sale_date', '2026-11-13'])
  })
  it('refuses a range over a year', async () => {
    const { ctx } = ctxWith({})
    const r = await runTool(ctx, 'sales_summary', { date_from: '2024-01-01', date_to: '2026-01-01' })
    expect(JSON.parse(r.text).error).toContain('366')
  })
})

describe('product_stock', () => {
  it('flags a counter that does not match the batches', async () => {
    const pid = '33333333-3333-4333-8333-333333333333'
    const { ctx } = ctxWith({
      stores: STORES, users: USERS,
      products: [{ id: pid, name: 'Аспирин', quantity_on_hand: 5 }],
      stock_batches: [
        { store_id: STORES[0].id, quantity_remaining: 3, unit_cost: '1.2', created_at: '2026-11-01T10:00:00Z' },
        { store_id: STORES[0].id, quantity_remaining: 1, unit_cost: '1.3', created_at: '2026-11-02T10:00:00Z' },
      ],
    })
    const out = JSON.parse((await runTool(ctx, 'product_stock', { product_id: pid })).text)
    expect(out.batches_total).toBe(4)
    expect(out.counter_matches_batches).toBe(false)
    expect(out.by_store).toEqual([{ store: 'Ботев', store_id: STORES[0].id, qty: 4 }])
  })
})

describe('parseNumber', () => {
  it('reads Д-000123, к-12 and plain numbers', () => {
    expect(parseNumber('Д-000123')).toBe(123)
    expect(parseNumber('к-12')).toBe(12)
    expect(parseNumber(7)).toBe(7)
    expect(parseNumber('няма')).toBeNull()
  })
})
