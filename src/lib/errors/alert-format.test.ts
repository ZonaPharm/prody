import { describe, it, expect } from 'vitest'
import { errorAlertHtml, errorAlertSubject, type AlertRow } from './alert-format'

const row = (over: Partial<AlertRow> = {}): AlertRow => ({
  source: 'server', kind: 'route', message: 'column x does not exist', path: '/record-sale',
  user_name: 'Ботев', count: 1, first_seen: '2026-11-17T08:00:00Z', last_seen: '2026-11-17T08:00:00Z', ...over,
})

describe('error alert e-mail', () => {
  it('says one or many in the subject', () => {
    expect(errorAlertSubject([row()])).toBe('Prody: нова грешка')
    expect(errorAlertSubject([row(), row()])).toBe('Prody: 2 нови грешки')
  })
  it('lists what, where, who and links to the screen', () => {
    const html = errorAlertHtml([row({ count: 3, source: 'browser' })], 'https://prody.example/')
    expect(html).toContain('column x does not exist')
    expect(html).toContain('В браузъра')
    expect(html).toContain('/record-sale')
    expect(html).toContain('Ботев')
    expect(html).toContain('3 пъти')
    expect(html).toContain('href="https://prody.example/settings?tab=errors"')
  })
  it('escapes the message, which may come from a browser', () => {
    const html = errorAlertHtml([row({ message: '<img src=x onerror=alert(1)>' })], undefined)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
  it('lists at most 20 and says how many more', () => {
    const rows = Array.from({ length: 23 }, (_, i) => row({ message: `грешка ${i}` }))
    const html = errorAlertHtml(rows, undefined)
    expect(html).toContain('грешка 19')
    expect(html).not.toContain('грешка 20<')
    expect(html).toContain('… и още 3.')
  })
})
