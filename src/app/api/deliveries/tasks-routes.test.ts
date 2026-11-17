import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "Шофьор и ден" of a trip and the notifications along the chain: what the routes
// accept, that a failed notification never fails the change, and that a person
// marks only their own notifications read.

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@test.bg', role: 'admin', display_name: 'Админ', is_active: true }
const DRIVER = '77777777-7777-4777-8777-777777777777'
const STORE = '55555555-5555-4555-8555-555555555555'
const TRIP = '33333333-3333-4333-8333-333333333333'
const SHIP = '44444444-4444-4444-8444-444444444444'

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  driver: null as null | Record<string, unknown>,
  adminRpc: vi.fn(),
  applyTripPlan: vi.fn(),
  notifyTripCreated: vi.fn(),
  notifyTripPlanChanged: vi.fn(),
  notifyTripSent: vi.fn(),
  notifyShipmentRemoved: vi.fn(),
  notifyTripCancelled: vi.fn(),
  notifyShipmentIssue: vi.fn(),
  readTrip: vi.fn(),
  updates: [] as { table: string; values: unknown; filters: [string, unknown][] }[],
  logAction: vi.fn(),
}))

function query(result: unknown, table = '') {
  const q: Record<string, any> = {}
  const filters: [string, unknown][] = []
  for (const m of ['select', 'order', 'limit']) q[m] = () => q
  for (const m of ['eq', 'in', 'is']) q[m] = (col: string, v: unknown) => { filters.push([`${m}:${col}`, v]); return q }
  q.update = (values: unknown) => { mocks.updates.push({ table, values, filters }); return q }
  q.single = () => Promise.resolve(result)
  q.maybeSingle = () => Promise.resolve(result)
  q.then = (ok: any, bad: any) => Promise.resolve({ error: null }).then(ok, bad)
  return q
}

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
      if (table === 'users') return query({ data: mocks.driver }, table)
      if (table === 'notifications') return query({ data: null }, table)
      if (table === 'shipments') return query({ data: { number: 45 } }, table)
      throw new Error(`unexpected admin table ${table}`)
    },
  }),
}))
vi.mock('@/lib/deliveries/trip-plan', async orig => ({
  ...(await orig<typeof import('@/lib/deliveries/trip-plan')>()),
  applyTripPlan: mocks.applyTripPlan,
}))
vi.mock('@/lib/deliveries/notify', () => ({
  notifyTripCreated: mocks.notifyTripCreated,
  notifyTripPlanChanged: mocks.notifyTripPlanChanged,
  notifyTripSent: mocks.notifyTripSent,
  notifyShipmentRemoved: mocks.notifyShipmentRemoved,
  notifyTripCancelled: mocks.notifyTripCancelled,
  notifyShipmentIssue: mocks.notifyShipmentIssue,
  readTrip: mocks.readTrip,
}))
vi.mock('@/lib/deliveries/driver', () => ({ verifyDriverPassword: async () => true }))
vi.mock('@/lib/audit', () => ({ logAction: mocks.logAction }))

import { POST as tripPOST } from './trips/route'
import { POST as planPOST } from './trips/[id]/plan/route'
import { POST as sendPOST } from './trips/[id]/send/route'
import { POST as cancelPOST } from './trips/[id]/cancel/route'
import { POST as addPOST } from './trips/[id]/add/route'
import { POST as removePOST } from './shipments/[id]/remove/route'
import { POST as confirmPOST } from '../shipments/[id]/confirm/route'
import { POST as readPOST } from '../notifications/read/route'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Request
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })

describe('trip driver and day, notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates = []
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    mocks.user = { id: ADMIN.id }
    mocks.profile = { ...ADMIN }
    mocks.driver = { id: DRIVER, email: 'd@test.bg', display_name: 'Ивайло', is_active: true }
    mocks.adminRpc.mockResolvedValue({ data: { trip_id: TRIP, number: 27, shipments: [{ shipment_id: SHIP }], signals: 0 }, error: null })
    mocks.applyTripPlan.mockResolvedValue({ error: null, before: { status: 'open', planned_driver_id: null, planned_date: null, planned_time: null } })
    mocks.readTrip.mockResolvedValue({ id: TRIP, number: 27 })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('a new trip with driver and day stores the plan, then tells the driver and the stores', async () => {
    const res = await tripPOST(req({ store_ids: [STORE], driver_id: DRIVER, planned_date: '2026-11-13', planned_time: '09:30' }))
    expect(res.status).toBe(200)
    expect(mocks.applyTripPlan).toHaveBeenCalledWith(expect.anything(), TRIP, { driver_id: DRIVER, planned_date: '2026-11-13', planned_time: '09:30' })
    expect(mocks.notifyTripCreated).toHaveBeenCalledWith(expect.anything(), TRIP)
    expect(mocks.applyTripPlan.mock.invocationCallOrder[0]).toBeLessThan(mocks.notifyTripCreated.mock.invocationCallOrder[0])
  })

  it('without driver and day the trip is made as before; the stores still hear it', async () => {
    const res = await tripPOST(req({ store_ids: [STORE] }))
    expect(res.status).toBe(200)
    expect(mocks.applyTripPlan).not.toHaveBeenCalled()
    expect(mocks.notifyTripCreated).toHaveBeenCalled()
  })

  it('an hour without a day is dropped; a bad date or hour is refused before anything', async () => {
    await tripPOST(req({ store_ids: [STORE], driver_id: DRIVER, planned_time: '09:30' }))
    expect(mocks.applyTripPlan).toHaveBeenCalledWith(expect.anything(), TRIP, { driver_id: DRIVER, planned_date: null, planned_time: null })
    vi.clearAllMocks()
    expect((await tripPOST(req({ store_ids: [STORE], planned_date: '13.11.2026' }))).status).toBe(400)
    expect((await tripPOST(req({ store_ids: [STORE], planned_date: '2026-11-13', planned_time: '25:00' }))).status).toBe(400)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('a deactivated driver is refused before the trip is made', async () => {
    mocks.driver = { id: DRIVER, is_active: false }
    expect((await tripPOST(req({ store_ids: [STORE], driver_id: DRIVER }))).status).toBe(400)
    expect(mocks.adminRpc).not.toHaveBeenCalled()
  })

  it('a plan that cannot be stored leaves the trip made, with a warning', async () => {
    mocks.applyTripPlan.mockRejectedValue(new Error('column does not exist'))
    const res = await tripPOST(req({ store_ids: [STORE], driver_id: DRIVER }))
    expect(res.status).toBe(200)
    expect((await res.json()).warning).toMatch(/Задайте ги в курса/)
  })

  it('changing driver and day: the plan, then the people concerned', async () => {
    const res = await planPOST(req({ driver_id: DRIVER, planned_date: '2026-11-14', planned_time: null }), params({ id: TRIP }))
    expect(res.status).toBe(200)
    expect(mocks.notifyTripPlanChanged).toHaveBeenCalledWith(expect.anything(), TRIP, expect.objectContaining({ planned_driver_id: null }))
  })

  it('a trip that left cannot be re-planned; a seller cannot plan at all', async () => {
    mocks.applyTripPlan.mockResolvedValue({ error: 'Курсът вече е тръгнал или е отказан', before: { status: 'departed' } })
    const res = await planPOST(req({ driver_id: null, planned_date: null, planned_time: null }), params({ id: TRIP }))
    expect(res.status).toBe(400)
    expect(mocks.notifyTripPlanChanged).not.toHaveBeenCalled()
    mocks.profile = { ...ADMIN, role: 'seller' }
    expect((await planPOST(req({ driver_id: null, planned_date: null, planned_time: null }), params({ id: TRIP }))).status).toBe(403)
  })

  it('each change along the chain sends its notification after the change', async () => {
    await sendPOST(req({ driver_id: DRIVER, password: 'x' }), params({ id: TRIP }))
    expect(mocks.notifyTripSent).toHaveBeenCalledWith(expect.anything(), TRIP, 'Ивайло')

    await addPOST(req({ store_ids: [STORE] }), params({ id: TRIP }))
    expect(mocks.notifyTripCreated).toHaveBeenCalledWith(expect.anything(), TRIP, { shipmentIds: [SHIP] })

    await removePOST(req({ reason: 'няма място' }), params({ id: SHIP }))
    expect(mocks.notifyShipmentRemoved).toHaveBeenCalledWith(expect.anything(), SHIP, 'няма място')

    await cancelPOST(req({ reason: 'няма кола' }), params({ id: TRIP }))
    expect(mocks.readTrip.mock.invocationCallOrder[0]).toBeLessThan(mocks.adminRpc.mock.invocationCallOrder.at(-1)!)
    expect(mocks.notifyTripCancelled).toHaveBeenCalledWith(expect.anything(), { id: TRIP, number: 27 }, 'няма кола')
  })

  it('a refused change sends nothing', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Курсът вече е тръгнал' } })
    await sendPOST(req({ driver_id: DRIVER, password: 'x' }), params({ id: TRIP }))
    await cancelPOST(req({ reason: 'няма кола' }), params({ id: TRIP }))
    expect(mocks.notifyTripSent).not.toHaveBeenCalled()
    expect(mocks.notifyTripCancelled).not.toHaveBeenCalled()
  })

  it('a store accepting with differences tells the admins', async () => {
    mocks.profile = { ...ADMIN, role: 'seller', store_id: STORE }
    mocks.adminRpc.mockResolvedValue({ data: { status: 'received_with_issues', signals: 2 }, error: null })
    const res = await confirmPOST(req({ lines: [{ line_id: SHIP, received_qty: 1, reason: 'missing' }] }), params({ id: SHIP }))
    expect(res.status).toBe(200)
    expect(mocks.notifyShipmentIssue).toHaveBeenCalledWith(expect.anything(), SHIP, 2)
  })

  describe('marking notifications read', () => {
    it('only the signed-in person, only their unread ones', async () => {
      const res = await readPOST(req({ ids: [SHIP] }))
      expect(res.status).toBe(200)
      expect(mocks.updates).toHaveLength(1)
      expect(mocks.updates[0].table).toBe('notifications')
      expect(mocks.updates[0].filters).toEqual([['eq:user_id', ADMIN.id], ['is:read_at', null], ['in:id', [SHIP]]])
    })

    it('401 without a session; an empty list changes nothing', async () => {
      mocks.user = null
      expect((await readPOST(req({}))).status).toBe(401)
      mocks.user = { id: ADMIN.id }
      expect((await readPOST(req({ ids: [] }))).status).toBe(200)
      expect(mocks.updates).toHaveLength(0)
    })
  })
})
