import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The order API routes: who gets in, what they accept, the e-mail before the
// "sent" mark, and how they call the database functions (tested in SQL,
// supabase/tests/supplier_orders.test.sql).

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true }
const ORDER = '22222222-2222-4222-8222-222222222222'
const SUPPLIER = '33333333-3333-4333-8333-333333333333'
const PRODUCT = '44444444-4444-4444-8444-444444444444'

function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'or', 'in', 'neq', 'not', 'delete', 'upsert']) q[m] = () => q
  q.single = () => Promise.resolve(result)
  q.maybeSingle = () => Promise.resolve(result)
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return q
}

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  order: null as null | Record<string, unknown>,
  mail: null as null | Record<string, unknown>,
  deleted: [] as unknown[],
  adminRpc: vi.fn(),
  sendMail: vi.fn(),
  logAction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      if (table === 'users') return query({ data: mocks.profile })
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table: string) => {
      if (table === 'email_settings') return query({ data: mocks.mail })
      if (table === 'supplier_orders') {
        const q = query({ data: mocks.order }) as Record<string, unknown>
        q.delete = () => query({ data: mocks.deleted, error: null })
        return q
      }
      throw new Error(`unexpected admin table ${table}`)
    },
  }),
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))
vi.mock('@/lib/supplier-orders/email', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supplier-orders/email')>()),
  sendOrderEmail: mocks.sendMail,
}))

import { POST as savePOST } from './route'
import { DELETE as orderDELETE } from './[id]/route'
import { POST as sendPOST } from './[id]/send/route'
import { POST as arrivedPOST } from './[id]/arrived/route'
import { POST as cancelPOST } from './[id]/cancel/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })

const saveBody = { id: null, supplier_id: SUPPLIER, notes: ' до петък ', items: [{ product_id: PRODUCT, quantity: 5, note: 'синя' }] }

function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: ORDER, number: 12, status: 'draft', notes: null, updated_at: 't', created_at: 't',
    sent_at: null, sent_via: null, sent_to: [], send_count: 0, received_at: null, delivery_id: null,
    cancelled_at: null, cancel_reason: null, creator: null, sender: null, delivery: null,
    supplier: { id: SUPPLIER, name: 'Панацея', is_active: true, order_emails: ['orders@panacea.bg'], contact_name: null, phone: null },
    items: [{ quantity: 5, note: null, sort_order: 1, product: { id: PRODUCT, name: 'Боя', sku: null, barcode: '3800000000001', status: 'active', quantity_on_hand: 2, images: [] } }],
    ...over,
  }
}

const READY_MAIL = { smtp_host: 'smtp.x', smtp_port: 587, smtp_user: 'u', smtp_pass: 'p', sender_email: 'shop@x.bg', order_signature: 'Зона Фарма' }

describe('supplier order API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN }
    mocks.order = orderRow()
    mocks.mail = { ...READY_MAIL }
    mocks.deleted = [{ id: ORDER, number: 12 }]
    mocks.adminRpc.mockResolvedValue({ data: { id: ORDER, number: 12, updated_at: 't' }, error: null })
    mocks.sendMail.mockResolvedValue(undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('401 without a session; 403 for a seller and for Офис', async () => {
    mocks.user = null
    expect((await savePOST(req(saveBody))).status).toBe(401)
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN, role: 'seller' }
    expect((await savePOST(req(saveBody))).status).toBe(403)
    mocks.profile = { ...ADMIN, role: 'seller', roles: ['office'] }
    expect((await sendPOST(req({ via: 'manual' }), params({ id: ORDER }))).status).toBe(403)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('save passes the whole draft to save_supplier_order', async () => {
    const res = await savePOST(req(saveBody))
    expect(res.status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('save_supplier_order', {
      p_order_id: null,
      p_user: ADMIN.id,
      p_expected_updated_at: null,
      p_order: { supplier_id: SUPPLIER, notes: 'до петък', items: [{ product_id: PRODUCT, quantity: 5, note: 'синя' }] },
    })
  })

  it('save refuses a fractional or zero quantity before the database', async () => {
    for (const quantity of [0, 1.5]) {
      const res = await savePOST(req({ ...saveBody, items: [{ product_id: PRODUCT, quantity }] }))
      expect(res.status).toBe(400)
    }
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('send by e-mail: the mail goes first, then the order is marked sent to those addresses', async () => {
    const res = await sendPOST(req({ via: 'email' }), params({ id: ORDER }))
    expect(res.status).toBe(200)
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    const [, doc, to, sender] = mocks.sendMail.mock.calls[0]
    expect(to).toEqual(['orders@panacea.bg'])
    expect(sender).toEqual({ email: ADMIN.email, name: ADMIN.display_name })
    expect(doc.lines).toEqual([{ name: 'Боя', barcode: '3800000000001', quantity: 5, note: null }])
    expect(doc.signature).toBe('Зона Фарма')
    expect(mocks.adminRpc).toHaveBeenCalledWith('send_supplier_order', { p_order_id: ORDER, p_user: ADMIN.id, p_via: 'email', p_to: ['orders@panacea.bg'] })
  })

  it('a failed e-mail does not mark the order sent', async () => {
    mocks.sendMail.mockRejectedValue(new Error('auth failed'))
    const res = await sendPOST(req({ via: 'email' }), params({ id: ORDER }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('не е отбелязана')
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('no supplier e-mail, or no mail settings: 400 with what to do, nothing sent', async () => {
    mocks.order = orderRow({ supplier: { id: SUPPLIER, name: 'Рома', is_active: true, order_emails: [], contact_name: null, phone: null } })
    let res = await sendPOST(req({ via: 'email' }), params({ id: ORDER }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Настройки → Доставчици')
    mocks.order = orderRow()
    mocks.mail = { ...READY_MAIL, smtp_pass: null }
    res = await sendPOST(req({ via: 'email' }), params({ id: ORDER }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Поръчах я сам')
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('"Поръчах я сам" only marks it, without e-mail', async () => {
    mocks.order = orderRow({ supplier: { id: SUPPLIER, name: 'Рома', is_active: true, order_emails: [], contact_name: null, phone: null } })
    const res = await sendPOST(req({ via: 'manual' }), params({ id: ORDER }))
    expect(res.status).toBe(200)
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(mocks.adminRpc).toHaveBeenCalledWith('send_supplier_order', { p_order_id: ORDER, p_user: ADMIN.id, p_via: 'manual', p_to: null })
  })

  it('an empty or arrived order is not sent', async () => {
    mocks.order = orderRow({ items: [] })
    expect((await sendPOST(req({ via: 'manual' }), params({ id: ORDER }))).status).toBe(400)
    mocks.order = orderRow({ status: 'received' })
    expect((await sendPOST(req({ via: 'email' }), params({ id: ORDER }))).status).toBe(400)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('"Пристигна" calls supplier_order_to_delivery and returns the delivery', async () => {
    mocks.adminRpc.mockResolvedValue({ data: { delivery_id: 'd1', created: true }, error: null })
    const res = await arrivedPOST(req(undefined), params({ id: ORDER }))
    expect(await res.json()).toEqual({ delivery_id: 'd1', created: true })
    expect(mocks.adminRpc).toHaveBeenCalledWith('supplier_order_to_delivery', { p_order_id: ORDER, p_user: ADMIN.id })
  })

  it('cancel needs a reason', async () => {
    expect((await cancelPOST(req({ reason: 'x' }), params({ id: ORDER }))).status).toBe(400)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
    expect((await cancelPOST(req({ reason: 'няма стока' }), params({ id: ORDER }))).status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('cancel_supplier_order', { p_order_id: ORDER, p_user: ADMIN.id, p_reason: 'няма стока' })
  })

  it('only a draft is deleted; a bad id is 404', async () => {
    expect((await orderDELETE(req(undefined), params({ id: ORDER }))).status).toBe(200)
    mocks.deleted = []
    expect((await orderDELETE(req(undefined), params({ id: ORDER }))).status).toBe(400)
    expect((await orderDELETE(req(undefined), params({ id: 'nope' }))).status).toBe(404)
  })
})
