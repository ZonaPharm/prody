import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const rpc = vi.fn()
const userRow = { current: null as any }
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: userRow.current }) }) }),
    }),
  }),
}))
// What Vercel puts on globalThis for each request (see keepAlive in server.ts).
const waitUntil = vi.fn()
;(globalThis as any)[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil }) }
const sendErrorAlert = vi.fn(async () => {})
vi.mock('./alert', () => ({ sendErrorAlert }))

import { recordError, handleRequestError, captureConsoleErrors, _resetThrottle } from './server'

const ID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b'
const realConsoleError = console.error

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  rpc.mockReset().mockResolvedValue({ data: false, error: null })
  sendErrorAlert.mockClear()
  waitUntil.mockClear()
  userRow.current = null
  _resetThrottle()
})

afterAll(() => {
  delete (globalThis as any)[Symbol.for('@vercel/request-context')]
  console.error = realConsoleError
  delete (globalThis as any)[Symbol.for('prody.consolePatched')]
  delete (globalThis as any)[Symbol.for('prody.rawConsoleError')]
})

describe('recordError', () => {
  it('writes one error through report_app_error', async () => {
    await recordError({ source: 'server', kind: 'route', message: 'boom', path: '/api/x?y=1' })
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('report_app_error')
    expect(args).toMatchObject({ p_source: 'server', p_kind: 'route', p_message: 'boom', p_path: '/api/x' })
  })

  it('writes the same error once in a burst', async () => {
    for (let i = 0; i < 5; i++) await recordError({ source: 'server', kind: 'log', message: `failed for row ${i}` })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('writes at most 60 errors a minute', async () => {
    for (let i = 0; i < 70; i++) await recordError({ source: 'server', kind: 'log', message: `fault number ${'x'.repeat(i)}` })
    expect(rpc).toHaveBeenCalledTimes(60)
  })

  it('sends the e-mail only when the database says nobody has been told', async () => {
    await recordError({ source: 'server', kind: 'log', message: 'old news' })
    expect(sendErrorAlert).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ data: true, error: null })
    await recordError({ source: 'server', kind: 'log', message: 'fresh' })
    expect(sendErrorAlert).toHaveBeenCalledTimes(1)
  })

  it('skips noise and does nothing without the server key', async () => {
    await recordError({ source: 'server', kind: 'render', message: 'NEXT_REDIRECT' })
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await recordError({ source: 'server', kind: 'render', message: 'real' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never throws when the database fails', async () => {
    rpc.mockRejectedValue(new Error('network down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordError({ source: 'server', kind: 'log', message: 'x' })).resolves.toBeUndefined()
    spy.mockRestore()
  })

  it('adds the user name when only the id is known, and drops an unknown id', async () => {
    userRow.current = { display_name: 'Ани', email: 'a@b.bg' }
    await recordError({ source: 'server', kind: 'route', message: 'a', userId: ID })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_user_id: ID, p_user_name: 'Ани' })
    userRow.current = null
    await recordError({ source: 'server', kind: 'route', message: 'b', userId: ID })
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_user_id: null, p_user_name: null })
  })
})

describe('console.error capture', () => {
  it('records console.error lines, once, after the original has printed', async () => {
    const printed: unknown[][] = []
    console.error = (...a: unknown[]) => { printed.push(a) }
    captureConsoleErrors()
    captureConsoleErrors() // a second call must not wrap twice

    console.error('tasks: notifications failed:', '{"code":"PGRST205"}')
    expect(printed).toHaveLength(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0][0]
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: 'log', p_message: 'tasks: notifications failed: {"code":"PGRST205"}' })
  })

  it('does not count a request error twice when Next also prints it', async () => {
    const err = new Error('render blew up')
    console.error(err)
    await handleRequestError(err, { path: '/dashboard', method: 'GET', headers: {} }, { routeType: 'render' })
    await Promise.all(waitUntil.mock.calls.map(c => c[0]))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: 'render', p_path: '/dashboard', p_message: 'render blew up' })
  })

  it('a failing database does not cause a loop of errors about errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no function' } })
    console.error('first failure')
    await Promise.all(waitUntil.mock.calls.map(c => c[0]))
    // Give any (wrong) recursive report a chance to run.
    await new Promise(r => setTimeout(r, 120))
    await Promise.all(waitUntil.mock.calls.map(c => c[0]))
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
