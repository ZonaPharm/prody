import { describe, it, expect } from 'vitest'
import {
  buildErrorRecord, consoleArgsToError, cut, describeError, errorFingerprint, isNoise,
  normalizeMessage, parseRecipients, alertRecipientsSchema, browserErrorSchema,
  sessionUserIdFromCookieHeader, stripQuery,
} from './shape'

const ID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b'

describe('normalizeMessage', () => {
  it('drops what changes every time: ids, times, numbers', () => {
    expect(normalizeMessage(`product ${ID} has 12 left at 2026-11-17T09:48:44.123Z`))
      .toBe('product <id> has <n> left at <time>')
  })
  it('collapses whitespace', () => {
    expect(normalizeMessage('a   b\n\tc')).toBe('a b c')
  })
})

describe('errorFingerprint', () => {
  it('is the same for the same fault with different ids', () => {
    const a = errorFingerprint('server', `column x missing for ${ID}`)
    const b = errorFingerprint('server', 'column x missing for 00000000-0000-0000-0000-000000000001')
    expect(a).toBe(b)
  })
  it('differs between server and browser, and between different faults', () => {
    expect(errorFingerprint('server', 'boom')).not.toBe(errorFingerprint('browser', 'boom'))
    expect(errorFingerprint('server', 'boom')).not.toBe(errorFingerprint('server', 'bang'))
  })
  it('fits the column (8 to 64 characters)', () => {
    const f = errorFingerprint('browser', 'x'.repeat(5000))
    expect(f.length).toBeGreaterThanOrEqual(8)
    expect(f.length).toBeLessThanOrEqual(64)
  })
})

describe('isNoise', () => {
  it.each([
    'NEXT_REDIRECT',
    'Error [AuthApiError]: Invalid Refresh Token: Refresh Token Not Found',
    'ResizeObserver loop completed with undelivered notifications.',
    'Script error.',
    'AbortError: The user aborted a request.',
  ])('ignores %s', m => expect(isNoise(m)).toBe(true))

  it('ignores errors thrown inside a browser extension', () => {
    expect(isNoise('TypeError: x is undefined', 'at foo (chrome-extension://abc/content.js:1:1)')).toBe(true)
  })
  it('keeps real faults', () => {
    expect(isNoise('column products.internal_barcode does not exist')).toBe(false)
    expect(isNoise('TypeError: Failed to fetch')).toBe(false)
  })
})

describe('buildErrorRecord', () => {
  it('shapes a row for report_app_error and cuts long fields', () => {
    const r = buildErrorRecord({
      source: 'server', kind: 'route', message: 'x'.repeat(3000), stack: 's'.repeat(9000),
      path: '/api/sales/group?q=secret', method: 'POST', userId: ID, userName: 'Ани', release: 'abc1234',
    })!
    expect(r.p_message.length).toBe(2000)
    expect(r.p_stack!.length).toBe(8000)
    expect(r.p_path).toBe('/api/sales/group')
    expect(r.p_user_id).toBe(ID)
    expect(r.p_release).toBe('abc1234')
    expect(r.p_fingerprint).toBe(errorFingerprint('server', r.p_message))
  })
  it('returns null for noise and for an empty message', () => {
    expect(buildErrorRecord({ source: 'server', kind: 'render', message: 'NEXT_REDIRECT' })).toBeNull()
    expect(buildErrorRecord({ source: 'server', kind: 'render', message: '   ' })).toBeNull()
  })
  it('drops a user id that is not a uuid', () => {
    expect(buildErrorRecord({ source: 'browser', kind: 'window', message: 'x', userId: "1' or 1=1" })!.p_user_id).toBeNull()
  })
})

describe('describeError', () => {
  it('reads an Error with its name, code, stack and digest', () => {
    const e = Object.assign(new TypeError('bad'), { code: '42703', digest: 'D1' })
    const d = describeError(e)
    expect(d.message).toBe('TypeError: bad [42703]')
    expect(d.stack).toContain('TypeError')
    expect(d.digest).toBe('D1')
  })
  it('reads a Supabase error object as JSON', () => {
    expect(describeError({ code: '42501', message: 'denied' }).message).toBe('{"code":"42501","message":"denied"}')
  })
  it('reads strings and odd values', () => {
    expect(describeError('plain').message).toBe('plain')
    expect(describeError(undefined).message).toBe('undefined')
    const loop: any = {}; loop.self = loop
    expect(describeError(loop).message).toBe('[object Object]')
  })
})

describe('consoleArgsToError', () => {
  it('joins a label and a JSON error into one message', () => {
    const r = consoleArgsToError(['tasks: notifications failed:', JSON.stringify({ code: 'PGRST205' })])
    expect(r.message).toBe('tasks: notifications failed: {"code":"PGRST205"}')
    expect(r.error).toBeNull()
  })
  it('keeps the Error object and its stack', () => {
    const e = new Error('boom')
    const r = consoleArgsToError(['logAction failed:', e])
    expect(r.message).toBe('logAction failed: boom')
    expect(r.error).toBe(e)
    expect(r.stack).toContain('boom')
  })
  it('drops printf placeholders', () => {
    expect(consoleArgsToError(['%s failed', 'x']).message).toBe('failed x')
  })
})

describe('stripQuery and cut', () => {
  it('keeps only the path', () => {
    expect(stripQuery('https://prody.bg/record-sale?x=1#top')).toBe('/record-sale')
    expect(stripQuery('/catalog?q=секрет')).toBe('/catalog')
    expect(stripQuery(null)).toBeNull()
  })
  it('cuts with an ellipsis and turns blanks into null', () => {
    expect(cut('abcdef', 4)).toBe('abc…')
    expect(cut('  ', 4)).toBeNull()
  })
})

describe('browser payload and recipients', () => {
  it('accepts a normal browser report and refuses an unknown kind', () => {
    expect(browserErrorSchema.safeParse({ kind: 'window', message: 'x', path: '/a' }).success).toBe(true)
    expect(browserErrorSchema.safeParse({ kind: 'server', message: 'x' }).success).toBe(false)
    expect(browserErrorSchema.safeParse({ kind: 'window', message: '' }).success).toBe(false)
  })
  it('splits typed addresses and checks them', () => {
    expect(parseRecipients(' a@b.bg, c@d.com;e@f.eu ')).toEqual(['a@b.bg', 'c@d.com', 'e@f.eu'])
    expect(parseRecipients('')).toEqual([])
    expect(alertRecipientsSchema.safeParse(['a@b.bg']).success).toBe(true)
    expect(alertRecipientsSchema.safeParse(['not-an-email']).success).toBe(false)
  })
})

describe('sessionUserIdFromCookieHeader', () => {
  const b64url = (s: string) => Buffer.from(s).toString('base64url')
  const jwt = (sub: string) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub }))}.sig`
  const session = (sub: string) => JSON.stringify({ access_token: jwt(sub), refresh_token: 'r' })

  it('reads the user from a base64 session cookie', () => {
    const value = 'base64-' + b64url(session(ID))
    expect(sessionUserIdFromCookieHeader(`a=1; sb-abcd-auth-token=${value}; b=2`)).toBe(ID)
  })
  it('joins a session split into chunks', () => {
    const value = 'base64-' + b64url(session(ID))
    const half = Math.floor(value.length / 2)
    const header = `sb-abcd-auth-token.1=${value.slice(half)}; sb-abcd-auth-token.0=${value.slice(0, half)}`
    expect(sessionUserIdFromCookieHeader(header)).toBe(ID)
  })
  it('reads a plain url-encoded JSON cookie', () => {
    expect(sessionUserIdFromCookieHeader(`sb-x-auth-token=${encodeURIComponent(session(ID))}`)).toBe(ID)
  })
  it('gives null for no cookie, garbage, or a subject that is not a uuid', () => {
    expect(sessionUserIdFromCookieHeader(undefined)).toBeNull()
    expect(sessionUserIdFromCookieHeader('sb-x-auth-token=%%%')).toBeNull()
    expect(sessionUserIdFromCookieHeader(`sb-x-auth-token=${encodeURIComponent(session('admin'))}`)).toBeNull()
  })
})
