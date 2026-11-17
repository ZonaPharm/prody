/**
 * A stand-in for the Supabase client in unit tests: records every call made on
 * a query and answers with whatever the test's handler returns for that table.
 * Test-only (imported by *.test.ts).
 */
export type Call = [string, ...unknown[]]
export type Query = { table: string; calls: Call[] }

export function fakeDb(handler: (q: Query) => unknown[] | { error: unknown }) {
  const queries: Query[] = []
  const db = {
    /** rpc('fn', args) is seen by the handler as table "rpc:fn"; its first row is the answer. */
    rpc(name: string, args: unknown) {
      const q: Query = { table: `rpc:${name}`, calls: [['rpc', args]] }
      queries.push(q)
      const r = handler(q)
      return Promise.resolve(Array.isArray(r) ? { data: r[0] ?? null, error: null } : { data: null, error: r.error })
    },
    from(table: string) {
      const q: Query = { table, calls: [] }
      queries.push(q)
      const result = () => {
        const r = handler(q)
        return Array.isArray(r) ? { data: r, error: null } : { data: null, error: r.error }
      }
      const builder: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result()).then(res, rej)
          if (prop === 'maybeSingle' || prop === 'single') {
            return () => {
              q.calls.push([prop])
              const r = result()
              return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error })
            }
          }
          if (prop === 'range') {
            return (from: number, to: number) => {
              q.calls.push(['range', from, to])
              const r = result()
              return Promise.resolve({ data: r.data ? r.data.slice(from, to + 1) : null, error: r.error })
            }
          }
          return (...args: unknown[]) => { q.calls.push([prop, ...args]); return builder }
        },
      })
      return builder
    },
  }
  return { db: db as any, queries }
}

/** A stand-in for Supabase Storage: buckets of files in memory. Test-only. */
export function fakeStorage(initial: Record<string, Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial)) // key "bucket/path"
  const buckets = new Set<string>(['products'])
  const storage = {
    files,
    getBucket: async (id: string) => ({ data: buckets.has(id) ? { id } : null, error: buckets.has(id) ? null : { message: 'not found' } }),
    createBucket: async (id: string) => { buckets.add(id); return { data: { name: id }, error: null } },
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array) => { files.set(`${bucket}/${path}`, new Uint8Array(bytes)); return { data: { path }, error: null } },
      download: async (path: string) => {
        const f = files.get(`${bucket}/${path}`)
        return f ? { data: new Blob([f as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }
      },
      remove: async (paths: string[]) => { for (const p of paths) files.delete(`${bucket}/${p}`); return { data: [], error: null } },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://db.example/storage/v1/object/public/${bucket}/${path}` } }),
      list: async () => ({ data: [], error: null }),
      createSignedUploadUrl: async (path: string) => ({ data: { token: 't', path }, error: null }),
    }),
  }
  return storage
}
