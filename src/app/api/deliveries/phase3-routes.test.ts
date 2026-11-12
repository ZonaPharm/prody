import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 3 API routes: labelling, trips, packing, the driver's signature,
// resolving signals and the store's checklist. Who gets in, what they accept,
// how they call the database functions (tested in SQL: deliveries_phase3.test.sql).

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true, store_id: null }
const SELLER = { id: '66666666-6666-4666-8666-666666666666', email: 'seller@test.bg', role: 'seller', display_name: 'Продавач', is_active: true, store_id: '55555555-5555-4555-8555-555555555555' }
const DRIVER = { id: '77777777-7777-4777-8777-777777777777', email: 'driver@test.bg', display_name: 'Шофьор', is_active: true }
const PLAN = '22222222-2222-4222-8222-222222222222'
const TRIP = '33333333-3333-4333-8333-333333333333'
const SHIP = '44444444-4444-4444-8444-444444444444'
const LINE = '88888888-8888-4888-8888-888888888888'
const STORE = '55555555-5555-4555-8555-555555555555'

function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) q[m] = () => q
  q.single = () => Promise.resolve(result)
  q.maybeSingle = () => Promise.resolve(result)
  return q
}

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  driver: null as null | Record<string, unknown>,
  passwordOk: true,
  adminRpc: vi.fn(),
  verify: vi.fn(),
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
      if (table === 'users') return query({ data: mocks.driver })
      if (table === 'shipments') return query({ data: { number: 45 } })
      throw new Error(`unexpected admin table ${table}`)
    },
  }),
}))
vi.mock('@/lib/deliveries/driver', () => ({
  verifyDriverPassword: async (...args: unknown[]) => { mocks.verify(...args); return mocks.passwordOk },
}))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { POST as readyPOST } from './ready/route'
import { POST as tripPOST } from './trips/route'
import { POST as tripCancelPOST } from './trips/[id]/cancel/route'
import { POST as tripSendPOST } from './trips/[id]/send/route'
import { POST as packPOST } from './shipments/[id]/pack/route'
import { POST as tripAddPOST } from './trips/[id]/add/route'
import { POST as removePOST } from './shipments/[id]/remove/route'
import { POST as reopenPOST } from './shipments/[id]/reopen/route'
import { POST as resolvePOST } from './signals/[id]/resolve/route'
import { POST as confirmPOST } from '../shipments/[id]/confirm/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })

describe('phase 3 delivery routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN }
    mocks.driver = { ...DRIVER }
    mocks.passwordOk = true
    mocks.adminRpc.mockResolvedValue({ data: { ready: 5, signals: 0 }, error: null })
  })
  afterEach(() => vi.unstubAllEnvs())

  describe('admin routes keep the gate', () => {
    it('403 for a seller, 404 with the switch off, no database call', async () => {
      mocks.profile = { ...SELLER }
      expect((await readyPOST(req({ rows: [{ plan_id: PLAN, qty: 1 }] }))).status).toBe(403)
      expect((await tripPOST(req({ store_ids: [STORE] }))).status).toBe(403)
      mocks.profile = { ...ADMIN }
      vi.stubEnv('DELIVERIES_ENABLED', 'off')
      expect((await packPOST(req({ lines: [{ line_id: LINE, qty: 1 }], box_count: 1 }), params({ id: SHIP }))).status).toBe(404)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })
  })

  it('labelling sends delivery lines and signals to label_items_checked as the signed-in admin', async () => {
    const res = await readyPOST(req({
      rows: [{ item_id: PLAN, qty: 3 }],
      signals: [{ item_id: PLAN, reason: 'damaged', qty_expected: 5, qty_actual: 3 }],
    }))
    expect(res.status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('label_items_checked', {
      p_user: ADMIN.id,
      p_rows: [{ item_id: PLAN, qty: 3 }],
      p_signals: [{ item_id: PLAN, reason: 'damaged', qty_expected: 5, qty_actual: 3, note: null }],
    })
  })

  it('a row labelled in part passes its split; whole rows go without one', async () => {
    const res = await readyPOST(req({
      rows: [{ item_id: PLAN, qty: 5, split: [{ store_id: STORE, qty: 3 }, { store_id: null, qty: 2 }] }, { item_id: TRIP, qty: 4 }],
    }))
    expect(res.status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('label_items_checked', {
      p_user: ADMIN.id,
      p_rows: [{ item_id: PLAN, qty: 5, split: [{ store_id: STORE, qty: 3 }, { store_id: null, qty: 2 }] }, { item_id: TRIP, qty: 4 }],
      p_signals: [],
    })
  })

  it('a refusal from the database reaches the screen as 400 with its message', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'За „Крем“ чакат етикет 5 бр., а отметнатите са 6 бр.' } })
    const res = await readyPOST(req({ rows: [{ item_id: PLAN, qty: 6 }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/чакат етикет 5 бр/)
  })

  it('a new trip passes each store once', async () => {
    mocks.adminRpc.mockResolvedValue({ data: { trip_id: TRIP, number: 12, shipments: [] }, error: null })
    const res = await tripPOST(req({ store_ids: [STORE, STORE] }))
    expect(res.status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('create_trip', { p_user: ADMIN.id, p_store_ids: [STORE], p_notes: null })
  })

  it('cancelling a trip needs a reason', async () => {
    expect((await tripCancelPOST(req({ reason: '' }), params({ id: TRIP }))).status).toBe(400)
    mocks.adminRpc.mockResolvedValue({ data: null, error: null })
    expect((await tripCancelPOST(req({ reason: 'грешен курс' }), params({ id: TRIP }))).status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('cancel_trip', { p_trip_id: TRIP, p_user: ADMIN.id, p_reason: 'грешен курс' })
  })

  describe('changing a trip before it leaves', () => {
    it('adds what became ready for the chosen stores, each store once', async () => {
      mocks.adminRpc.mockResolvedValue({ data: { trip_id: TRIP, number: 12, units: 7, shipments: [] }, error: null })
      expect((await tripAddPOST(req({ store_ids: [] }), params({ id: TRIP }))).status).toBe(400)
      const res = await tripAddPOST(req({ store_ids: [STORE, STORE] }), params({ id: TRIP }))
      expect(res.status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('add_to_trip', { p_trip_id: TRIP, p_user: ADMIN.id, p_store_ids: [STORE] })
      expect(mocks.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'trip_changed', details: 'К-000012: добавени 7 бр.' }), expect.anything())
    })

    it('removing a store from the trip needs a reason', async () => {
      expect((await removePOST(req({ reason: ' ' }), params({ id: SHIP }))).status).toBe(400)
      mocks.adminRpc.mockResolvedValue({ data: null, error: null })
      expect((await removePOST(req({ reason: 'не се събра' }), params({ id: SHIP }))).status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('remove_shipment', { p_shipment_id: SHIP, p_user: ADMIN.id, p_reason: 'не се събра' })
    })

    it('reopens a packed shipment; the database message comes back as it is', async () => {
      mocks.adminRpc.mockResolvedValue({ data: null, error: null })
      expect((await reopenPOST(req({}), params({ id: SHIP }))).status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('reopen_packing', { p_shipment_id: SHIP, p_user: ADMIN.id })
      mocks.adminRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Курс К-000012 не се променя: той е тръгнал' } })
      const res = await reopenPOST(req({}), params({ id: SHIP }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Курс К-000012 не се променя: той е тръгнал')
    })

    it('is for admins only and checks the id', async () => {
      mocks.user = { id: SELLER.id }
      mocks.profile = { ...SELLER }
      expect((await reopenPOST(req({}), params({ id: SHIP }))).status).toBe(403)
      expect((await tripAddPOST(req({ store_ids: [STORE] }), params({ id: TRIP }))).status).toBe(403)
      mocks.user = { id: ADMIN.id }
      mocks.profile = { ...ADMIN }
      expect((await removePOST(req({ reason: 'abc' }), params({ id: 'x' }))).status).toBe(404)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })
  })

  describe("the driver's signature", () => {
    it('checks the password of the chosen driver, then sends the trip in their name', async () => {
      mocks.adminRpc.mockResolvedValue({ data: { shipments: 2, units: 10 }, error: null })
      const res = await tripSendPOST(req({ driver_id: DRIVER.id, password: 'тайна' }), params({ id: TRIP }))
      expect(res.status).toBe(200)
      expect(mocks.verify).toHaveBeenCalledWith(DRIVER.id, DRIVER.email, 'тайна')
      expect(mocks.adminRpc).toHaveBeenCalledWith('send_trip', { p_trip_id: TRIP, p_driver: DRIVER.id })
    })

    it('a wrong password moves nothing', async () => {
      mocks.passwordOk = false
      const res = await tripSendPOST(req({ driver_id: DRIVER.id, password: 'грешна' }), params({ id: TRIP }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Грешна парола/)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('a deactivated driver cannot sign', async () => {
      mocks.driver = { ...DRIVER, is_active: false }
      const res = await tripSendPOST(req({ driver_id: DRIVER.id, password: 'тайна' }), params({ id: TRIP }))
      expect(res.status).toBe(400)
      expect(mocks.verify).not.toHaveBeenCalled()
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('an account without the Шофьор role cannot sign', async () => {
      mocks.driver = { ...DRIVER, roles: ['seller'] }
      const res = await tripSendPOST(req({ driver_id: DRIVER.id, password: 'тайна' }), params({ id: TRIP }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/няма роля Шофьор/)
      expect(mocks.verify).not.toHaveBeenCalled()
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('Офис + Шофьор signs', async () => {
      mocks.driver = { ...DRIVER, roles: ['office', 'driver'] }
      const res = await tripSendPOST(req({ driver_id: DRIVER.id, password: 'тайна' }), params({ id: TRIP }))
      expect(res.status).toBe(200)
    })
  })

  it('packing sends lines, boxes and signals', async () => {
    mocks.adminRpc.mockResolvedValue({ data: { lines: 1, units: 2, signals: 1, unready: 2 }, error: null })
    const res = await packPOST(req({
      lines: [{ line_id: LINE, qty: 2 }],
      box_count: 1,
      signals: [{ line_id: LINE, reason: 'missing', qty_expected: 4, qty_actual: 2 }],
    }), params({ id: SHIP }))
    expect(res.status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('pack_shipment_checked', {
      p_shipment_id: SHIP,
      p_user: ADMIN.id,
      p_lines: [{ line_id: LINE, qty: 2 }],
      p_box_count: 1,
      p_signals: [{ line_id: LINE, reason: 'missing', qty_expected: 4, qty_actual: 2, note: null }],
    })
  })

  it('resolving a signal is signed by the admin', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: null })
    const res = await resolvePOST(req({ resolution: 'found', note: ' в склада ' }), params({ id: PLAN }))
    expect(res.status).toBe(200)
    expect(mocks.adminRpc).toHaveBeenCalledWith('resolve_signal', { p_signal_id: PLAN, p_user: ADMIN.id, p_resolution: 'found', p_note: 'в склада' })
  })

  describe("the store's checklist", () => {
    const body = { lines: [{ line_id: LINE, received_qty: 3, reason: 'short', note: 'един липсва' }] }

    it('a seller confirms in their own name; the database checks the store', async () => {
      mocks.user = { id: SELLER.id }
      mocks.profile = { ...SELLER }
      mocks.adminRpc.mockResolvedValue({ data: { status: 'received_with_issues', signals: 1 }, error: null })
      const res = await confirmPOST(req(body), params({ id: SHIP }))
      expect(res.status).toBe(200)
      expect(mocks.adminRpc).toHaveBeenCalledWith('confirm_shipment', {
        p_shipment_id: SHIP,
        p_user: SELLER.id,
        p_lines: [{ line_id: LINE, received_qty: 3, reason: 'short', note: 'един липсва' }],
      })
    })

    it('401 without a session, 403 for a deactivated account, 404 with the switch off', async () => {
      mocks.user = null
      expect((await confirmPOST(req(body), params({ id: SHIP }))).status).toBe(401)
      mocks.user = { id: SELLER.id }
      mocks.profile = { ...SELLER, is_active: false }
      expect((await confirmPOST(req(body), params({ id: SHIP }))).status).toBe(403)
      mocks.profile = { ...SELLER }
      vi.stubEnv('DELIVERIES_ENABLED', 'off')
      expect((await confirmPOST(req(body), params({ id: SHIP }))).status).toBe(404)
      expect(mocks.adminRpc).not.toHaveBeenCalled()
    })

    it('another store is refused by the database and the message reaches the seller', async () => {
      mocks.user = { id: SELLER.id }
      mocks.profile = { ...SELLER }
      mocks.adminRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Само обект Варна или администратор може да потвърди пратка П-000045' } })
      const res = await confirmPOST(req(body), params({ id: SHIP }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Само обект/)
    })
  })
})
