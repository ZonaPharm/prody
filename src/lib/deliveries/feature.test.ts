import { describe, expect, it } from 'vitest'
import { deliveriesEnabledFor } from './feature'

describe('deliveriesEnabledFor', () => {
  it('is off in production when the switch is not set', () => {
    expect(deliveriesEnabledFor('a@x.bg', { VERCEL_ENV: 'production', NODE_ENV: 'production' })).toBe(false)
  })

  it('is on in a Vercel preview and in next dev when the switch is not set (both use staging)', () => {
    expect(deliveriesEnabledFor('a@x.bg', { VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(true)
    expect(deliveriesEnabledFor('a@x.bg', { NODE_ENV: 'development' })).toBe(true)
  })

  it('"all" turns it on for everyone, "off" for nobody, whatever the environment', () => {
    expect(deliveriesEnabledFor('a@x.bg', { DELIVERIES_ENABLED: 'all', VERCEL_ENV: 'production' })).toBe(true)
    expect(deliveriesEnabledFor('a@x.bg', { DELIVERIES_ENABLED: ' OFF ', VERCEL_ENV: 'preview' })).toBe(false)
  })

  it('a list of e-mails is the pilot: only those, case and spaces ignored', () => {
    const env = { DELIVERIES_ENABLED: 'Vladimir@X.bg, b@y.bg', VERCEL_ENV: 'production' }
    expect(deliveriesEnabledFor('vladimir@x.bg', env)).toBe(true)
    expect(deliveriesEnabledFor(' B@Y.BG ', env)).toBe(true)
    expect(deliveriesEnabledFor('c@z.bg', env)).toBe(false)
    expect(deliveriesEnabledFor(null, env)).toBe(false)
  })
})
