import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyShipmentIssue, notifyTripCreated, notifyTripPlanChanged, notifyTripSent } from './notify'

// Who gets which notification, read from a fake database. Texts are tested in notify-text.test.ts.

const TRIP = {
  id: 't1', number: 27, status: 'open', planned_driver_id: 'drv', planned_date: '2026-11-13', planned_time: '09:30:00',
  shipments: [
    { id: 's1', number: 35, store_id: 'botev', status: 'packing', box_count: null, store: { name: 'Ботев' }, lines: [{ qty: 6, product_id: 'p1' }, { qty: 4, product_id: 'p2' }] },
    { id: 's2', number: 36, store_id: 'center', status: 'cancelled', box_count: null, store: { name: 'Център' }, lines: [] },
  ],
}
const USERS = [
  { id: 'drv', role: 'seller', is_active: true, store_id: 'office', email: 'd@x' },
  { id: 'old', role: 'seller', is_active: true, store_id: 'office', email: 'o@x' },
  { id: 'sell1', role: 'seller', is_active: true, store_id: 'botev', email: 's1@x' },
  { id: 'sell2', role: 'seller', is_active: false, store_id: 'botev', email: 's2@x' },
  { id: 'sell3', role: 'seller', is_active: true, store_id: 'center', email: 's3@x' },
  { id: 'adm', role: 'admin', is_active: true, store_id: null, email: 'a@x' },
]

let inserted: any[] = []
let failInsert = false

function fakeAdmin(trip: any = TRIP) {
  return {
    from(table: string) {
      const f: Record<string, any> = {}
      const q: any = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: any) => { f[c] = v; return q },
        in: (c: string, v: any) => { f[c] = v; return q },
        maybeSingle: async () => {
          if (table === 'trips') return { data: trip, error: null }
          if (table === 'shipments') return { data: { id: 's1', number: 35, trip_id: 't1', store: { name: 'Ботев' } }, error: null }
          return { data: null, error: null }
        },
        insert: async (rows: any[]) => {
          if (failInsert) return { error: { message: 'relation "notifications" does not exist' } }
          inserted.push(...rows)
          return { error: null }
        },
        then: (ok: any) => {
          let rows = USERS
          if (f.id) rows = rows.filter(u => f.id.includes(u.id))
          if (f.store_id) rows = rows.filter(u => f.store_id.includes(u.store_id))
          if (f.role) rows = rows.filter(u => u.role === f.role)
          return Promise.resolve({ data: rows, error: null }).then(ok)
        },
      }
      return q
    },
  }
}

describe('notify', () => {
  beforeEach(() => {
    inserted = []
    failInsert = false
    vi.stubEnv('DELIVERIES_ENABLED', 'all')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('a new trip: the driver and the active sellers of each store still on it', async () => {
    await notifyTripCreated(fakeAdmin(), 't1')
    expect(inserted.map(r => [r.user_id, r.kind])).toEqual([['drv', 'trip_assigned'], ['sell1', 'shipment_coming']])
    expect(inserted[0].title).toContain('9:30')
    expect(inserted[0].link).toBe('/my-tasks')
    expect(inserted[1]).toMatchObject({ shipment_id: 's1', trip_id: 't1' })
    expect(inserted[1].title).toContain('10 бр.')
  })

  it('added to a trip: only the stores of the given shipments, no new driver message', async () => {
    await notifyTripCreated(fakeAdmin(), 't1', { shipmentIds: ['s1'] })
    expect(inserted.map(r => r.user_id)).toEqual(['sell1'])
  })

  it('a new driver hears it, the old one hears it is not theirs; same day, stores are not told', async () => {
    await notifyTripPlanChanged(fakeAdmin(), 't1', { planned_driver_id: 'old', planned_date: '2026-11-13', planned_time: '09:30' })
    expect(inserted.map(r => [r.user_id, r.kind])).toEqual([['old', 'trip_unassigned'], ['drv', 'trip_assigned']])
  })

  it('a moved day reaches the driver and the stores', async () => {
    await notifyTripPlanChanged(fakeAdmin(), 't1', { planned_driver_id: 'drv', planned_date: '2026-11-12', planned_time: null })
    expect(inserted.map(r => [r.user_id, r.kind])).toEqual([['drv', 'trip_changed'], ['sell1', 'trip_changed']])
  })

  it('on the way: the seller is sent to the shipment page', async () => {
    const sent = { ...TRIP, status: 'departed', shipments: [{ ...TRIP.shipments[0], status: 'sent', box_count: 2 }] }
    await notifyTripSent(fakeAdmin(sent), 't1', 'Ивайло')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ user_id: 'sell1', kind: 'shipment_sent', link: '/my-shipments/s1' })
  })

  it('differences at a store: the admins with deliveries on', async () => {
    await notifyShipmentIssue(fakeAdmin(), 's1', 2)
    expect(inserted.map(r => [r.user_id, r.link])).toEqual([['adm', '/deliveries/problems']])
    inserted = []
    await notifyShipmentIssue(fakeAdmin(), 's1', 0)
    expect(inserted).toEqual([])
  })

  it('a failure (e.g. the table is missing) is logged, never thrown', async () => {
    failInsert = true
    await expect(notifyTripCreated(fakeAdmin(), 't1')).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })
})
