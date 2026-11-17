import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD_BYTES, UPLOAD_BUCKET, UPLOAD_TTL_MS, UploadError, checkUpload, createUpload, ensureBucket,
  ownsUpload, resetBucketCheck, sweepUploads, takeUpload, uploadPath,
} from './uploads'

const USER = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-2222-3333-4444-555555555555'
const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** A small in-memory stand-in for Supabase Storage. */
function fakeStorage(opts: { bucket?: boolean; files?: Record<string, { bytes?: Uint8Array; created_at?: string }> } = {}) {
  let bucket = opts.bucket ?? true
  const files = new Map(Object.entries(opts.files ?? {}))
  const log: string[] = []
  const storage = {
    files, log,
    getBucket: async (id: string) => { log.push(`getBucket ${id}`); return { data: bucket ? { id } : null, error: bucket ? null : { message: 'not found' } } },
    createBucket: async (id: string, o: any) => { log.push(`createBucket ${id} public=${o.public} limit=${o.fileSizeLimit}`); bucket = true; return { data: { name: id }, error: null } },
    from: (b: string) => {
      expect(b).toBe(UPLOAD_BUCKET)
      return {
        createSignedUploadUrl: async (path: string) => { log.push(`sign ${path}`); return { data: { token: 'tok', path }, error: null } },
        download: async (path: string) => {
          log.push(`download ${path}`)
          const f = files.get(path)
          return f ? { data: new Blob([(f.bytes ?? new Uint8Array([1])) as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
        remove: async (paths: string[]) => { log.push(`remove ${paths.join(',')}`); for (const p of paths) files.delete(p); return { data: [], error: null } },
        list: async (prefix: string) => {
          if (!prefix) {
            const folders = [...new Set([...files.keys()].map(k => k.split('/')[0]))]
            return { data: folders.map(name => ({ name, id: null })), error: null }
          }
          const data = [...files.entries()].filter(([k]) => k.startsWith(prefix + '/'))
            .map(([k, f]) => ({ name: k.slice(prefix.length + 1), id: 'x', created_at: f.created_at ?? new Date().toISOString() }))
          return { data, error: null }
        },
      }
    },
  }
  return storage
}

beforeEach(() => resetBucketCheck())

describe('upload paths', () => {
  it('a path is the person\'s folder and a random name, keeping only the extension', () => {
    expect(uploadPath(USER, 'Фактура 12.PDF', FILE)).toBe(`${USER}/${FILE}.pdf`)
    expect(uploadPath(USER, 'no-extension', FILE)).toBe(`${USER}/${FILE}`)
  })
  it('only the person\'s own upload is accepted', () => {
    expect(ownsUpload(USER, `${USER}/${FILE}.pdf`)).toBe(true)
    expect(ownsUpload(USER, `${OTHER}/${FILE}.pdf`)).toBe(false)
    expect(ownsUpload(USER, `${USER}/../${OTHER}/${FILE}.pdf`)).toBe(false)
    expect(ownsUpload(USER, `${USER}/x.pdf`)).toBe(false)
    expect(ownsUpload(USER, 42)).toBe(false)
  })
})

describe('checkUpload', () => {
  it('takes a 15 MB PDF, refuses over 20 MB and unknown kinds', () => {
    expect(checkUpload('f.pdf', 'application/pdf', 15 * 1024 * 1024)).toBeNull()
    expect(checkUpload('f.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1)).toContain('20 MB')
    expect(checkUpload('f.exe', '', 100)).toContain('не се чете')
    expect(checkUpload('f.pdf', '', 0)).toContain('празен')
  })
})

describe('createUpload', () => {
  it('makes the private bucket the first time, then gives a one-time link', async () => {
    const s = fakeStorage({ bucket: false })
    const link = await createUpload(s, USER, 'f.pdf', 'application/pdf', 5_000_000)
    expect(link.bucket).toBe(UPLOAD_BUCKET)
    expect(link.token).toBe('tok')
    expect(ownsUpload(USER, link.path)).toBe(true)
    expect(s.log).toContain(`createBucket ${UPLOAD_BUCKET} public=false limit=${MAX_UPLOAD_BYTES}`)
    await createUpload(s, USER, 'g.pdf', 'application/pdf', 5_000_000)
    expect(s.log.filter(l => l.startsWith('getBucket'))).toHaveLength(1)
  })
  it('refuses a too big file before anything is made', async () => {
    const s = fakeStorage()
    await expect(createUpload(s, USER, 'f.pdf', '', MAX_UPLOAD_BYTES + 1)).rejects.toBeInstanceOf(UploadError)
    expect(s.log).toEqual([])
  })
  it('an existing bucket is not made again', async () => {
    const s = fakeStorage()
    await ensureBucket(s)
    expect(s.log.some(l => l.startsWith('createBucket'))).toBe(false)
  })
})

describe('takeUpload', () => {
  it('reads the file and deletes it straight away', async () => {
    const path = `${USER}/${FILE}.pdf`
    const s = fakeStorage({ files: { [path]: { bytes: new Uint8Array([1, 2, 3]) } } })
    const bytes = await takeUpload(s, path)
    expect([...bytes]).toEqual([1, 2, 3])
    expect(s.files.has(path)).toBe(false)
  })
  it('deletes it even when it cannot be used', async () => {
    const path = `${USER}/${FILE}.pdf`
    const s = fakeStorage({ files: { [path]: { bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1) } } })
    await expect(takeUpload(s, path)).rejects.toBeInstanceOf(UploadError)
    expect(s.files.has(path)).toBe(false)
  })
  it('a missing file gives a plain message', async () => {
    await expect(takeUpload(fakeStorage(), `${USER}/${FILE}`)).rejects.toThrow('Прикачете го отново')
  })
})

describe('sweepUploads', () => {
  const now = Date.parse('2026-11-17T12:00:00Z')
  const old = new Date(now - UPLOAD_TTL_MS - 1000).toISOString()
  const fresh = new Date(now - 60_000).toISOString()

  it('removes leftovers older than an hour in every folder, keeps fresh ones', async () => {
    const s = fakeStorage({
      files: {
        [`${USER}/a.pdf`]: { created_at: old },
        [`${USER}/b.pdf`]: { created_at: fresh },
        [`${OTHER}/c.pdf`]: { created_at: old },
      },
    })
    expect(await sweepUploads(s, { now })).toBe(2)
    expect([...s.files.keys()]).toEqual([`${USER}/b.pdf`])
  })
  it('can sweep one person\'s folder only', async () => {
    const s = fakeStorage({ files: { [`${USER}/a.pdf`]: { created_at: old }, [`${OTHER}/c.pdf`]: { created_at: old } } })
    expect(await sweepUploads(s, { folder: USER, now })).toBe(1)
    expect(s.files.has(`${OTHER}/c.pdf`)).toBe(true)
  })
  it('never throws', async () => {
    const broken = { getBucket: null, createBucket: null, from: () => { throw new Error('down') } }
    expect(await sweepUploads(broken)).toBe(0)
  })
})
