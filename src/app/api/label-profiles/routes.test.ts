import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The label paper profile routes: the deliveries gate, the checks on the body,
// and what goes to the table (written with the service role).

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true }
const SELLER = { ...ADMIN, role: 'seller' }
const PROFILE = '22222222-2222-4222-8222-222222222222'
const L = { cols: 3, rows: 8, width: 70, height: 37, top: 0.5, left: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: -1.5 }
const ROW = { id: PROFILE, name: '24 Офис', cols: 3, rows: 8, width_mm: '70.00', height_mm: '37.00', top_mm: '0.50', left_mm: '0.00', gap_x_mm: '0.00', gap_y_mm: '0.00', offset_x_mm: '0.00', offset_y_mm: '-1.50' }

const mocks = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  result: { data: null as unknown, error: null as unknown },
  calls: [] as { op: string; arg?: unknown }[],
}))

function chain() {
  const q: Record<string, any> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = (a?: unknown) => { if (m === 'eq') mocks.calls.push({ op: 'eq', arg: a }); return q }
  q.insert = (row: unknown) => { mocks.calls.push({ op: 'insert', arg: row }); return q }
  q.update = (row: unknown) => { mocks.calls.push({ op: 'update', arg: row }); return q }
  q.delete = () => { mocks.calls.push({ op: 'delete' }); return q }
  q.single = () => Promise.resolve(mocks.result)
  q.maybeSingle = () => Promise.resolve(mocks.result)
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(mocks.result).then(res)
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN.id } } }) },
    from: (table: string) => {
      if (table === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: mocks.profile }) }) }) }
      return chain()
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => chain() }) }))
vi.mock('@/lib/audit', () => ({ logAction: vi.fn() }))

import { GET, POST } from './route'
import { DELETE, PATCH } from './[id]/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('label profile routes', () => {
  beforeEach(() => {
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.profile = { ...ADMIN }
    mocks.result = { data: ROW, error: null }
    mocks.calls = []
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sellers get 403 and nothing is written', async () => {
    mocks.profile = { ...SELLER }
    expect((await POST(req({ name: 'X', layout: L }))).status).toBe(403)
    expect((await DELETE(req({}), params(PROFILE))).status).toBe(403)
    expect(mocks.calls).toEqual([])
  })

  it('lists the profiles as layouts in mm', async () => {
    mocks.result = { data: [ROW], error: null }
    const res = await GET()
    expect(await res.json()).toEqual([{ id: PROFILE, name: '24 Офис', layout: L }])
  })

  it('saves a new profile with who made it', async () => {
    const res = await POST(req({ name: ' 24  Офис ', layout: L }))
    expect(res.status).toBe(200)
    expect(mocks.calls[0]).toEqual({ op: 'insert', arg: expect.objectContaining({ name: '24 Офис', cols: 3, top_mm: 0.5, offset_y_mm: -1.5, created_by: ADMIN.id }) })
    expect((await res.json()).layout).toEqual(L)
  })

  it('refuses a layout that does not fit A4 before the database', async () => {
    const res = await POST(req({ name: 'X', layout: { ...L, rows: 9 } }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/височина/)
    expect(mocks.calls).toEqual([])
  })

  it('the same name twice is a 400 in Bulgarian', async () => {
    mocks.result = { data: null, error: { code: '23505', message: 'duplicate' } }
    const res = await POST(req({ name: '24 Офис', layout: L }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Вече има профил/)
  })

  it('changes and deletes by id; an unknown id is 404', async () => {
    expect((await PATCH(req({ layout: { ...L, offsetX: 1 } }), params(PROFILE))).status).toBe(200)
    expect(mocks.calls.find(c => c.op === 'update')!.arg).toEqual(expect.objectContaining({ offset_x_mm: 1 }))
    expect((await DELETE(req({}), params(PROFILE))).status).toBe(200)
    expect((await DELETE(req({}), params('nope'))).status).toBe(404)
    mocks.result = { data: null, error: null }
    expect((await PATCH(req({ name: 'Ново' }), params(PROFILE))).status).toBe(404)
  })
})
