import { beforeEach, describe, expect, it, vi } from 'vitest'

// Настройки → Имейл: only an active admin reads or saves, and the SMTP password
// never goes back to a browser.

const ROW = {
  id: 1,
  smtp_host: 'smtp-relay.brevo.com',
  smtp_port: 587,
  smtp_user: 'user@brevo',
  smtp_pass: 'secret-pass',
  sender_email: 'prody@zonapharm.bg',
  recipients: ['a@zonapharm.bg'],
  report_day: 5,
  report_hour: 18,
  order_signature: 'Зона Фарма',
}

const mocks = vi.hoisted(() => ({
  user: { id: 'u1', email: 'x@test.bg' } as null | Record<string, unknown>,
  profile: null as null | Record<string, unknown>,
  row: null as null | Record<string, unknown>,
  upserts: [] as Record<string, unknown>[],
  logAction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) q[m] = () => q
      if (table === 'users') {
        q.single = async () => ({ data: mocks.profile })
        return q
      }
      if (table === 'email_settings') {
        q.single = async () => ({ data: mocks.row })
        q.upsert = (row: Record<string, unknown>) => {
          mocks.upserts.push(row)
          const merged = { ...mocks.row, ...row }
          const r: Record<string, unknown> = {}
          r.select = () => r
          r.single = async () => ({ data: merged, error: null })
          return r
        }
        return q
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { GET, POST } from './route'

const req = (body: unknown) => ({ json: async () => body }) as any

describe('/api/email-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'u1', email: 'x@test.bg' }
    mocks.profile = { role: 'admin', is_active: true, display_name: 'Владимир' }
    mocks.row = { ...ROW }
    mocks.upserts = []
  })

  it('401 without a session', async () => {
    mocks.user = null
    expect((await GET()).status).toBe(401)
    expect((await POST(req({}))).status).toBe(401)
  })

  it('403 for a seller, Офис or a deactivated admin', async () => {
    mocks.profile = { role: 'seller', is_active: true }
    expect((await GET()).status).toBe(403)
    expect((await POST(req({ smtp_host: 'evil' }))).status).toBe(403)
    mocks.profile = { role: 'admin', is_active: false }
    expect((await GET()).status).toBe(403)
    expect(mocks.upserts).toHaveLength(0)
  })

  it('an admin gets the settings without the password', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).not.toHaveProperty('smtp_pass')
    expect(JSON.stringify(body)).not.toContain('secret-pass')
    expect(body).toMatchObject({ smtp_host: 'smtp-relay.brevo.com', smtp_pass_set: true })
  })

  it('no saved password: smtp_pass_set is false', async () => {
    mocks.row = { ...ROW, smtp_pass: null }
    expect(await (await GET()).json()).toMatchObject({ smtp_pass_set: false })
  })

  it('saving with an empty password keeps the saved one', async () => {
    const res = await POST(req({ smtp_host: 'smtp.new', smtp_pass: '', smtp_pass_set: true, id: 7 }))
    expect(res.status).toBe(200)
    expect(mocks.upserts[0]).not.toHaveProperty('smtp_pass')
    expect(mocks.upserts[0]).not.toHaveProperty('smtp_pass_set')
    expect(mocks.upserts[0]).toMatchObject({ id: 1, smtp_host: 'smtp.new' })
    const body = await res.json()
    expect(body).not.toHaveProperty('smtp_pass')
  })

  it('a new password is saved but not sent back', async () => {
    const res = await POST(req({ smtp_pass: 'new-pass' }))
    expect(res.status).toBe(200)
    expect(mocks.upserts[0]).toMatchObject({ smtp_pass: 'new-pass' })
    expect(JSON.stringify(await res.json())).not.toContain('new-pass')
  })

  it('unknown columns are ignored and bad values refused', async () => {
    await POST(req({ order_signature: 'hack', updated_by: 'x', report_hour: 9 }))
    expect(mocks.upserts[0]).not.toHaveProperty('order_signature')
    expect(mocks.upserts[0]).not.toHaveProperty('updated_by')
    expect(mocks.upserts[0]).toMatchObject({ report_hour: 9 })
    const bad = await POST(req({ recipients: ['not-an-email'] }))
    expect(bad.status).toBe(400)
    expect(mocks.upserts).toHaveLength(1)
  })
})
