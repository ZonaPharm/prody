import { describe, expect, it } from 'vitest'
import { mayUseAssistant } from './access'

describe('mayUseAssistant', () => {
  it('an active admin with the tick may', () => {
    expect(mayUseAssistant({ role: 'admin', roles: ['admin'] }, true)).toBe(true)
  })
  it('without the tick nobody may', () => {
    expect(mayUseAssistant({ role: 'admin', roles: ['admin'] }, false)).toBe(false)
  })
  it('Офис, a seller or a driver may not, even with a tick left in the table', () => {
    expect(mayUseAssistant({ role: 'seller', roles: ['office', 'driver'] }, true)).toBe(false)
    expect(mayUseAssistant({ role: 'seller', roles: ['seller'] }, true)).toBe(false)
    expect(mayUseAssistant({ role: 'seller', roles: ['accountant'] }, true)).toBe(false)
  })
  it('a deactivated admin may not', () => {
    expect(mayUseAssistant({ role: 'admin', roles: ['admin'], is_active: false }, true)).toBe(false)
  })
  it('before the roles migration the old role still decides', () => {
    expect(mayUseAssistant({ role: 'admin' }, true)).toBe(true)
  })
})
