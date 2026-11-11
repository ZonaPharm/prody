import { describe, expect, it } from 'vitest'
import { deliveriesActive } from './feature'
import { resolutionOptions, resolveError } from './resolve'
import { tripReadyToSend, boxesText } from './trip-format'
import { confirmSchema, packSchema, readySchema, resolveSchema, tripSendSchema } from './schemas'

const ID = '11111111-1111-4111-8111-111111111111'

describe('deliveriesActive (the stores side)', () => {
  it('follows the switch, on for a pilot list too', () => {
    expect(deliveriesActive({ DELIVERIES_ENABLED: 'a@b.bg' })).toBe(true)
    expect(deliveriesActive({ DELIVERIES_ENABLED: 'all' })).toBe(true)
    expect(deliveriesActive({ DELIVERIES_ENABLED: 'off' })).toBe(false)
    expect(deliveriesActive({ VERCEL_ENV: 'production' })).toBe(false)
    expect(deliveriesActive({ VERCEL_ENV: 'preview' })).toBe(true)
  })
})

describe('resolution options', () => {
  it('a store signal can be found (units back) or confirmed missing', () => {
    expect(resolutionOptions('store_receive').map(o => o.value)).toEqual(['found', 'corrected', 'other'])
    expect(resolutionOptions('receive').map(o => o.value)).toEqual(['returned_to_supplier', 'corrected', 'other'])
  })
  it('"Друго" needs a note', () => {
    expect(resolveError('other', ' ')).toMatch(/Напишете/)
    expect(resolveError(null, '')).toMatch(/Изберете/)
    expect(resolveError('found', '')).toBeNull()
  })
})

describe('trip format', () => {
  it('a trip leaves only when every live shipment is packed', () => {
    expect(tripReadyToSend([{ status: 'packed' }, { status: 'packing' }])).toBe(false)
    expect(tripReadyToSend([{ status: 'packed' }, { status: 'cancelled' }])).toBe(true)
    expect(tripReadyToSend([])).toBe(false)
    expect(boxesText(1)).toBe('1 кашон')
    expect(boxesText(3)).toBe('3 кашона')
  })
})

describe('phase 3 schemas', () => {
  it('readySchema needs something and a note for "Друго"', () => {
    expect(readySchema.safeParse({ rows: [], signals: [] }).success).toBe(false)
    expect(readySchema.safeParse({ signals: [{ item_id: ID, reason: 'other' }] }).success).toBe(false)
    expect(readySchema.safeParse({ rows: [{ item_id: ID, qty: 2 }] }).success).toBe(true)
    expect(readySchema.safeParse({ rows: [{ item_id: ID, qty: 0 }] }).success).toBe(false)
  })
  it('packSchema needs at least one box', () => {
    expect(packSchema.safeParse({ lines: [{ line_id: ID, qty: 1 }], box_count: 0 }).success).toBe(false)
    expect(packSchema.safeParse({ lines: [{ line_id: ID, qty: 1 }], box_count: 2 }).success).toBe(true)
  })
  it('confirmSchema takes the store reasons only', () => {
    expect(confirmSchema.safeParse({ lines: [{ line_id: ID, received_qty: 1, reason: 'short' }] }).success).toBe(true)
    expect(confirmSchema.safeParse({ lines: [{ line_id: ID, received_qty: 1, reason: 'partial' }] }).success).toBe(false)
    expect(confirmSchema.safeParse({ lines: [{ line_id: ID, received_qty: 1, reason: 'other' }] }).success).toBe(false)
  })
  it('resolveSchema and tripSendSchema', () => {
    expect(resolveSchema.safeParse({ resolution: 'found' }).success).toBe(true)
    expect(resolveSchema.safeParse({ resolution: 'deleted' }).success).toBe(false)
    expect(tripSendSchema.safeParse({ driver_id: ID, password: '' }).success).toBe(false)
  })
})
