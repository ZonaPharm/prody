import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The delivery API routes: who gets in, what they accept, and how they call
// the database functions. The functions themselves are tested in SQL
// (supabase/tests/deliveries*.test.sql).

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true }
const DELIVERY = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const PRODUCT = '44444444-4444-4444-8444-444444444444'
const STORE = '55555555-5555-4555-8555-555555555555'

function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'or', 'in', 'neq', 'not']) q[m] = () => q
  q.single = () => Promise.resolve(result)
  q.maybeSingle = () => Promise.resolve(result)
  return q
}

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  itemInDelivery: true,
  deliveryStatus: 'expected',
  adminRpc: vi.fn(),
  adminInsert: vi.fn(),
  logAction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user } }) },
    from: (table: string) => {
      if (table === 'users') return query({ data: mocks.profile })
      if (table === 'delivery_items') return query({ data: mocks.itemInDelivery ? { id: ITEM } : null })
      if (table === 'suppliers') return query({ data: { name: 'Temu' } })
      if (table === 'deliveries') return query({ data: { status: mocks.deliveryStatus } })
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: () => ({ insert: (row: unknown) => { mocks.adminInsert(row); return query({ data: { id: PRODUCT, ...(row as object), images: [] }, error: null }) } }),
  }),
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { POST as draftPOST } from './draft/route'
import { POST as savePOST } from './[id]/save/route'
import { POST as receivePOST } from './[id]/receive/route'
import { POST as cancelPOST } from './[id]/cancel/route'
import { PATCH as planPATCH } from './[id]/items/[itemId]/plan/route'
import { POST as productPOST } from './products/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })

const draftBody = {
  id: null,
  expected_updated_at: null,
  draft: {
    order_ref: 'PO-1',
    items: [{ key: 'k1', product_id: PRODUCT, supplier_id: null, quantity: 10, unit_cost: 2.5, plan: [{ store_id: STORE, planned_qty: 4 }] }],
  },
}

describe('delivery API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN }
    mocks.itemInDelivery = true
    mocks.deliveryStatus = 'expected'
    mocks.adminRpc.mockResolvedValue({ data: { id: DELIVERY, updated_at: 't', items: [] }, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  describe('the gate', () => {
    it('401 without a session', async () => {
      mocks.user = null
      expect((await draftPOST(req(draftBody))).status).toBe(401)
    })

    it('403 for a seller and for a deactivated admin', async () => {
      mocks.profile = { ...ADMIN, role: 'seller' }
      expect((await draftPOST(req(draftBody))).status).toBe(403)
      mocks.profile = { ...ADMIN, is_active: false }
      expect((await receivePOST(req({ lines: [{ item_id: ITEM, qty: 1 }] }), params({ id: DELIVERY }))).status).toBe(403)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('Офис (not an admin) cannot enter, receive, distribute or cancel a delivery', async () => {
      mocks.profile = { ...ADMIN, role: 'seller', roles: ['office', 'driver'] }
      for (const res of [
        await draftPOST(req(draftBody)),
        await savePOST(req({}), params({ id: DELIVERY })),
        await receivePOST(req({ lines: [{ item_id: ITEM, qty: 1 }] }), params({ id: DELIVERY })),
        await cancelPOST(req({ reason: 'x' }), params({ id: DELIVERY })),
        await planPATCH(req({ plan: [] }), params({ id: DELIVERY, itemId: ITEM })),
      ]) {
        expect(res.status).toBe(403)
        expect((await res.json()).error).toBe('Само администратор може да прави това')
      }
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('404 while the feature switch is off for this admin', async () => {
      vi.stubEnv('DELIVERIES_ENABLED', 'someone-else@test.bg')
      expect((await draftPOST(req(draftBody))).status).toBe(404)
      vi.stubEnv('DELIVERIES_ENABLED', 'off')
      expect((await savePOST(req({}), params({ id: DELIVERY }))).status).toBe(404)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('404 for an id that is not a uuid, without touching the database', async () => {
      expect((await savePOST(req({}), params({ id: 'abc' }))).status).toBe(404)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })
  })

  describe('draft autosave', () => {
    it('sends the whole draft to save_delivery_draft as the signed-in admin', async () => {
      const res = await draftPOST(req(draftBody))
      expect(res.status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('save_delivery_draft', {
        p_delivery_id: null,
        p_user: ADMIN.id,
        p_expected_updated_at: null,
        p_draft: {
          order_ref: 'PO-1',
          notes: null,
          items: [{
            id: null, key: 'k1', product_id: PRODUCT, supplier_id: null, doc_number: null, pack_size: 1,
            quantity: 10, unit_cost: 2.5, needs_label: null, plan: [{ store_id: STORE, planned_qty: 4 }],
          }],
        },
      })
    })

    it('400 for a line without quantity or with a negative cost', async () => {
      const bad = structuredClone(draftBody)
      bad.draft.items[0].quantity = 0
      const res = await draftPOST(req(bad))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Количеството/)
      const bad2 = structuredClone(draftBody)
      bad2.draft.items[0].unit_cost = -1
      expect((await draftPOST(req(bad2))).status).toBe(400)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('takes the version it read only as a timestamp', async () => {
      const ok = await draftPOST(req({ ...draftBody, id: DELIVERY, expected_updated_at: '2026-11-11T07:20:00.123456+00:00' }))
      expect(ok.status).toBe(200)
      const bad = await draftPOST(req({ ...draftBody, id: DELIVERY, expected_updated_at: 'вчера' }))
      expect(bad.status).toBe(400)
    })

    it('passes a conflict raised by the function to the screen as 400', async () => {
      mocks.adminRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Черновата е променена от друг човек след като я отворихте. Презаредете страницата.' } })
      const res = await draftPOST(req(draftBody))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/променена от друг/)
    })
  })

  describe('save', () => {
    it('numbers the delivery and logs it', async () => {
      mocks.adminRpc.mockResolvedValue({ data: 124, error: null })
      const res = await savePOST(req({}), params({ id: DELIVERY }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true, number: 124 })
      expect(mocks.adminRpc).toHaveBeenCalledWith('save_delivery', { p_delivery_id: DELIVERY, p_user: ADMIN.id })
      expect(mocks.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'delivery_saved', details: 'Д-000124' }), expect.anything())
    })
  })

  describe('receive', () => {
    it('sends received lines and signals in one receive_delivery_checked call', async () => {
      mocks.adminRpc.mockResolvedValue({ data: { received: 8, auto_ready: 0, signals: 1 }, error: null })
      const res = await receivePOST(req({
        lines: [{ item_id: ITEM, qty: 8 }],
        signals: [{ item_id: ITEM, reason: 'short', qty_expected: 10, qty_actual: 8 }],
      }), params({ id: DELIVERY }))
      expect(res.status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('receive_delivery_checked', {
        p_delivery_id: DELIVERY,
        p_user: ADMIN.id,
        p_lines: [{ item_id: ITEM, qty: 8 }],
        p_signals: [{ item_id: ITEM, reason: 'short', qty_expected: 10, qty_actual: 8, note: null }],
      })
    })

    it('400 when nothing is ticked, for an unknown reason, and for "Друго" without a note', async () => {
      expect((await receivePOST(req({ lines: [], signals: [] }), params({ id: DELIVERY }))).status).toBe(400)
      expect((await receivePOST(req({ signals: [{ item_id: ITEM, reason: 'stolen' }] }), params({ id: DELIVERY }))).status).toBe(400)
      expect((await receivePOST(req({ signals: [{ item_id: ITEM, reason: 'other' }] }), params({ id: DELIVERY }))).status).toBe(400)
      expect((await receivePOST(req({ lines: [{ item_id: ITEM, qty: 0 }] }), params({ id: DELIVERY }))).status).toBe(400)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('a rule the database raised (over-receiving) is a 400 with its message', async () => {
      mocks.adminRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Приемане над доставеното за „Крем“: в доставката 10 бр., приети 10 бр., сега 1 бр.' } })
      const res = await receivePOST(req({ lines: [{ item_id: ITEM, qty: 1 }] }), params({ id: DELIVERY }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Приемане над доставеното/)
      expect(mocks.logAction).not.toHaveBeenCalled()
    })
  })

  describe('plan and cancel', () => {
    it('update_plan only for a line of the delivery in the URL', async () => {
      mocks.adminRpc.mockResolvedValue({ data: null, error: null })
      const ok = await planPATCH(req({ rows: [{ store_id: STORE, planned_qty: 3 }] }), params({ id: DELIVERY, itemId: ITEM }))
      expect(ok.status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('update_plan', { p_item_id: ITEM, p_user: ADMIN.id, p_rows: [{ store_id: STORE, planned_qty: 3 }] })

      mocks.adminRpc.mockClear()
      mocks.itemInDelivery = false
      const other = await planPATCH(req({ rows: [{ store_id: STORE, planned_qty: 3 }] }), params({ id: DELIVERY, itemId: ITEM }))
      expect(other.status).toBe(404)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('leaves the plan of a draft to the draft screen', async () => {
      mocks.deliveryStatus = 'draft'
      const res = await planPATCH(req({ rows: [{ store_id: STORE, planned_qty: 3 }] }), params({ id: DELIVERY, itemId: ITEM }))
      expect(res.status).toBe(409)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('cancel needs a reason', async () => {
      expect((await cancelPOST(req({ reason: ' ' }), params({ id: DELIVERY }))).status).toBe(400)
      mocks.adminRpc.mockResolvedValue({ data: null, error: null })
      expect((await cancelPOST(req({ reason: 'Грешна фактура' }), params({ id: DELIVERY }))).status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('cancel_delivery', { p_delivery_id: DELIVERY, p_user: ADMIN.id, p_reason: 'Грешна фактура' })
    })
  })

  describe('new product from a delivery', () => {
    it('is active with no stock, and keeps the supplier name in the old "Източник"', async () => {
      const res = await productPOST(req({ name: 'Нов крем', price: 9.9, supplier_id: STORE, needs_label: false }))
      expect(res.status).toBe(200)
      expect(mocks.adminInsert).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Нов крем', price: 9.9, status: 'active', quantity_on_hand: 0, source: 'Temu', needs_label: false,
      }))
      const body = await res.json()
      expect(body.suggested.supplier_id).toBe(STORE)
    })

    it('400 without a sale price', async () => {
      expect((await productPOST(req({ name: 'Нов крем', price: 0 }))).status).toBe(400)
      expect(mocks.adminInsert).not.toHaveBeenCalled()
    })
  })
})
