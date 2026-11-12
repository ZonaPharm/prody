import { describe, expect, it } from 'vitest'
import { fetchAll, fetchByIds } from './fetch-all'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`)

describe('fetchByIds', () => {
  it('splits the ids into chunks and returns the rows in chunk order', async () => {
    const seen: string[][] = []
    const rows = await fetchByIds<{ id: string }>(chunk => {
      seen.push(chunk)
      // The first chunk answers last: order must still follow the ids.
      const delay = chunk[0] === 'id-0' ? 20 : 0
      return new Promise(resolve => setTimeout(() => resolve({ data: chunk.map(id => ({ id })), error: null }), delay))
    }, ids(450), 200)
    expect(seen.map(c => c.length)).toEqual([200, 200, 50])
    expect(rows.map(r => r.id)).toEqual(ids(450))
  })

  it('sends the chunks together rather than one after another', async () => {
    let inFlight = 0
    let most = 0
    await fetchByIds<string>(chunk => {
      inFlight++
      most = Math.max(most, inFlight)
      return new Promise(resolve => setTimeout(() => { inFlight--; resolve({ data: chunk, error: null }) }, 5))
    }, ids(600), 200)
    expect(most).toBe(3)
  })

  it('fails when any chunk fails', async () => {
    const boom = { message: 'fetch failed' }
    await expect(fetchByIds<string>(chunk =>
      Promise.resolve(chunk[0] === 'id-200' ? { data: null, error: boom } : { data: chunk, error: null }),
    ids(450), 200)).rejects.toBe(boom)
  })

  it('makes no request for an empty list', async () => {
    let calls = 0
    expect(await fetchByIds<string>(() => { calls++; return Promise.resolve({ data: [], error: null }) }, [])).toEqual([])
    expect(calls).toBe(0)
  })
})

describe('fetchAll', () => {
  it('pages until a short page', async () => {
    const all = ids(2500)
    const rows = await fetchAll<string>(() => ({
      range: (from: number, to: number) => Promise.resolve({ data: all.slice(from, to + 1), error: null }),
    }))
    expect(rows).toEqual(all)
  })
})
