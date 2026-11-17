import { describe, it, expect, vi } from 'vitest'

const insert = vi.fn(async (_row: unknown) => ({ error: null }))
const from = vi.fn((_t: string) => ({ insert }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))
// The user's own session must not be used: audit_logs takes rows only from admins that way.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => { throw new Error('session client used for the activity log') },
}))

import { logAction, logAuth } from './audit'

describe('activity log', () => {
  it('writes through the server key, whoever did the action', async () => {
    await logAction({ action: 'request_create', userId: 'u1', entityType: 'stock_request', details: '3 продукта' })
    expect(from).toHaveBeenCalledWith('audit_logs')
    expect(insert.mock.calls[0][0]).toMatchObject({ type: 'action', action: 'request_create', user_id: 'u1', details: '3 продукта' })
  })

  it('writes login lines the same way', async () => {
    await logAuth({ action: 'login', userId: 'u2', status: 'success' })
    expect(insert.mock.calls[1][0]).toMatchObject({ type: 'auth', action: 'login', status: 'success' })
  })

  it('never throws when the write fails', async () => {
    insert.mockRejectedValueOnce(new Error('down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(logAction({ action: 'x' })).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
