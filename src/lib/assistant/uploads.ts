/**
 * Big attachments for the assistant.
 *
 * A request to the app on Vercel carries at most about 4.5 MB, so a bigger
 * file goes from the browser straight into a private Storage bucket (with a
 * one-time signed upload link), and the question then names it. The server
 * reads it once and deletes it at once, before it is even processed: nothing
 * the person attaches stays on the server. Anything left behind (a page closed
 * between the upload and the question) is removed by the nightly job, and by
 * the person's next upload.
 *
 * The bucket has no access rules, so only the server (service role) can read
 * or list it. It is created by the app the first time it is needed.
 */
import { randomUUID } from 'crypto'
import { attachmentKind } from './attachments'

export const UPLOAD_BUCKET = 'ai-uploads'
/** The largest file a person can attach. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
/** Up to this size the file goes with the question itself (Vercel takes about 4.5 MB per request). */
export const DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024
/** An upload not used within this time is a leftover. */
export const UPLOAD_TTL_MS = 60 * 60 * 1000

export class UploadError extends Error {}

const PATH = /^([0-9a-f-]{36})\/([0-9a-f-]{36})(\.[a-z0-9]{1,5})?$/

export function uploadPath(userId: string, name: string, id = randomUUID()): string {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase()
  return `${userId}/${id}${ext ? '.' + ext : ''}`
}

/** A path from the browser is used only if it is one of this person's own uploads. */
export function ownsUpload(userId: string, path: unknown): path is string {
  if (typeof path !== 'string') return false
  const m = PATH.exec(path)
  return !!m && m[1] === userId.toLowerCase()
}

export function checkUpload(name: string, type: string, size: number): string | null {
  if (!attachmentKind(name, type)) return 'Този вид файл не се чете. Пратете снимка (JPG, PNG), PDF, Excel или CSV.'
  if (!Number.isFinite(size) || size <= 0) return 'Файлът е празен.'
  if (size > MAX_UPLOAD_BYTES) return `Файлът е над ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Пратете само нужните страници.`
  return null
}

type Storage = { getBucket: any; createBucket: any; from: (b: string) => any }

let bucketReady: Promise<void> | null = null

/** Makes the private bucket if it is not there yet (once per server instance). */
export function ensureBucket(storage: Storage): Promise<void> {
  bucketReady ??= (async () => {
    const { data } = await storage.getBucket(UPLOAD_BUCKET)
    if (data) return
    const { error } = await storage.createBucket(UPLOAD_BUCKET, { public: false, fileSizeLimit: MAX_UPLOAD_BYTES })
    if (error && !/already exists|duplicate/i.test(error.message ?? '')) throw error
  })().catch(err => { bucketReady = null; throw err })
  return bucketReady
}

/** Test hook: forget that the bucket was checked. */
export function resetBucketCheck() { bucketReady = null }

/** A one-time link the browser uploads this one file to. */
export async function createUpload(storage: Storage, userId: string, name: string, type: string, size: number) {
  const problem = checkUpload(name, type, size)
  if (problem) throw new UploadError(problem)
  await ensureBucket(storage)
  const path = uploadPath(userId, name)
  const { data, error } = await storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path)
  if (error || !data?.token) throw new Error(error?.message || 'no upload link')
  return { bucket: UPLOAD_BUCKET, path, token: data.token as string }
}

/**
 * Reads an upload and deletes it straight away, whatever happens next.
 * The bytes live only in this request's memory from here on.
 */
export async function takeUpload(storage: Storage, path: string): Promise<Uint8Array> {
  const bucket = storage.from(UPLOAD_BUCKET)
  try {
    const { data, error } = await bucket.download(path)
    if (error || !data) throw new UploadError('Каченият файл не се намери. Прикачете го отново.')
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError(`Файлът е над ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`)
    return bytes
  } finally {
    await bucket.remove([path]).catch(() => {})
  }
}

/**
 * Removes uploads older than the TTL: in one person's folder, or (no folder)
 * in every folder. Returns how many files were removed. Never throws.
 */
export async function sweepUploads(storage: Storage, opts: { folder?: string; now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now()
  let removed = 0
  try {
    const bucket = storage.from(UPLOAD_BUCKET)
    const folders = opts.folder ? [opts.folder] : ((await bucket.list('', { limit: 1000 })).data ?? [])
      .filter((f: any) => !f.id) // folders have no id
      .map((f: any) => f.name)
    for (const folder of folders) {
      const { data } = await bucket.list(folder, { limit: 1000 })
      const old = (data ?? [])
        .filter((f: any) => f.id && now - Date.parse(f.created_at || f.updated_at || '') > UPLOAD_TTL_MS)
        .map((f: any) => `${folder}/${f.name}`)
      if (old.length) {
        const { error } = await bucket.remove(old)
        if (!error) removed += old.length
      }
    }
  } catch (err) {
    console.error('assistant upload sweep failed:', err)
  }
  return removed
}
