import { beforeEach, describe, expect, it, vi } from 'vitest'

// Настройки → Потребители: several roles for one person, checked on the server.

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin' }
const OTHER = '22222222-2222-4222-8222-222222222222'
const OFFICE = '33333333-3333-4333-8333-333333333333'
const BOTEV = '44444444-4444-4444-8444-444444444444'

const mocks = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  updateError: null as null | Record<string, unknown>,
  logAction: vi.fn(),
}))

function chain(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q
  q.single = () => Promise.resolve(result)
  q.maybeSingle = () => Promise.resolve(result)
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN.id, email: ADMIN.email } } }) },
    from: () => chain({ data: mocks.profile }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { updateUserById: async () => ({ error: null }) } },
    from: (table: string) => {
      if (table === 'users') {
        return {
          update: (row: Record<string, unknown>) => {
            mocks.updates.push(row)
            return { eq: async () => ({ error: mocks.updateError }) }
          },
        }
      }
      throw new Error(`unexpected admin table ${table}`)
    },
  }),
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { PUT } from './[id]/route'

const req = (body: unknown) => ({ json: async () => body }) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('PUT /api/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profile = { role: 'admin' }
    mocks.updates = []
    mocks.updateError = null
  })

  it('saves Офис + Шофьор without a store, role derived as seller', async () => {
    const res = await PUT(req({ display_name: 'Ивайло', roles: ['driver', 'office'], store_id: OFFICE }), params(OTHER))
    expect(res.status).toBe(200)
    expect(mocks.updates[0]).toEqual({ display_name: 'Ивайло', roles: ['office', 'driver'], role: 'seller', store_id: null })
    expect(mocks.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'user_update', details: 'Ивайло: Офис, Шофьор' }), expect.anything())
  })

  it('anybody can also be a seller, in Офис too', async () => {
    const res = await PUT(req({ display_name: 'Ивайло', roles: ['office', 'seller', 'driver'], store_id: OFFICE }), params(OTHER))
    expect(res.status).toBe(200)
    expect(mocks.updates[0]).toMatchObject({ roles: ['office', 'seller', 'driver'], role: 'seller', store_id: OFFICE })
  })

  it('a seller needs a store', async () => {
    const res = await PUT(req({ display_name: 'Кунка', roles: ['seller'] }), params(OTHER))
    expect(res.status).toBe(400)
    expect(mocks.updates).toHaveLength(0)
    const ok = await PUT(req({ display_name: 'Кунка', roles: ['seller'], store_id: BOTEV }), params(OTHER))
    expect(ok.status).toBe(200)
    expect(mocks.updates[0]).toMatchObject({ roles: ['seller'], role: 'seller', store_id: BOTEV })
  })

  it('an older page sending one role still works', async () => {
    const res = await PUT(req({ display_name: 'Мира', role: 'admin' }), params(OTHER))
    expect(res.status).toBe(200)
    expect(mocks.updates[0]).toMatchObject({ roles: ['admin'], role: 'admin', store_id: null })
  })

  it('an admin cannot take away their own Администратор role', async () => {
    const res = await PUT(req({ display_name: 'Аз', roles: ['office'] }), params(ADMIN.id))
    expect(res.status).toBe(400)
    expect(mocks.updates).toHaveLength(0)
  })

  it('says to run the migration when the roles column is missing', async () => {
    mocks.updateError = { code: 'PGRST204', message: 'column roles not found' }
    const res = await PUT(req({ display_name: 'Деси', roles: ['accountant'] }), params(OTHER))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/20261112_user_roles/)
  })

  it('only admins', async () => {
    mocks.profile = { role: 'seller' }
    const res = await PUT(req({ display_name: 'X', roles: ['admin'] }), params(OTHER))
    expect(res.status).toBe(403)
    expect(mocks.updates).toHaveLength(0)
  })
})
