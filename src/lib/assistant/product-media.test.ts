import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { MEDIA_TOOLS, PRODUCT_IMAGE_EDGE, productImage } from './product-media'
import { runTool } from './registry'
import { namesLoader, type ActContext } from './tools'
import { fakeDb, fakeStorage, type Query } from './fake-db'
import { resetBucketCheck } from './uploads'

const P1 = '11111111-1111-4111-8111-111111111111'
const CONV = '44444444-4444-4444-8444-444444444444'

async function photo(w = 3000, h = 2000) {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#f0f0f0' } }).jpeg().toBuffer())
}

function setup(tables: Record<string, unknown[]>, act: Partial<ActContext> = {}) {
  resetBucketCheck()
  const cards: any[] = []
  const storage = fakeStorage()
  const f = fakeDb((q: Query) => {
    if (q.table === 'ai_actions') {
      const ins = q.calls.find(c => c[0] === 'insert')?.[1] as any
      return ins ? [{ id: 'card-1', ...ins, result: null }] : []
    }
    return tables[q.table] ?? []
  })
  const ctx = {
    db: f.db, names: namesLoader(f.db),
    act: { userId: 'u1', userName: 'Мира', conversationId: CONV, questionSeq: 1, deliveries: true, emit: (c: unknown) => cards.push(c), storage, ...act },
  }
  const run = async (name: string, input: unknown) => JSON.parse((await runTool(ctx as any, name, input)).text)
  return { run, cards, storage, queries: f.queries }
}

describe('productImage', () => {
  it('turns any photo into an upright WebP of at most 1600 px', async () => {
    const out = await productImage(await photo(4000, 1000))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(PRODUCT_IMAGE_EDGE)
  })
  it('refuses what is not a picture', async () => {
    await expect(productImage(new Uint8Array([1, 2, 3]))).rejects.toThrow('не е снимка')
  })
})

describe('propose_product_image', () => {
  it('the attached photo waits privately on a card; nothing is added to the product', async () => {
    const s = setup({ products: [{ id: P1, name: 'Магнезий B6' }], product_images: [] }, { image: { name: 'IMG_1.jpg', bytes: await photo() } })
    const out = await s.run('propose_product_image', { product_id: P1, source: 'attached' })
    expect(out.ok).toBe(true)
    expect(s.cards).toHaveLength(1)
    const card = s.cards[0]
    expect(card.kind).toBe('product_image')
    expect(card.title).toBe('Снимка за „Магнезий B6“')
    // A product without photos gets it as the main one.
    expect(card.payload).toMatchObject({ product_id: P1, main: true, image_count: 0, width: 1600 })
    expect(card.payload.pending_path).toMatch(/^pending\/[0-9a-f-]{36}\.webp$/)
    expect([...s.storage.files.keys()]).toEqual([`ai-uploads/${card.payload.pending_path}`])
    // Only ai_actions is written in the database.
    const writes = s.queries.filter(q => q.calls.some(c => ['insert', 'update', 'upsert', 'delete'].includes(c[0] as string)))
    expect(writes.map(q => q.table)).toEqual(['ai_actions'])
  })
  it('a product that has photos keeps its main one unless asked', async () => {
    const s = setup({ products: [{ id: P1, name: 'Цинк' }], product_images: [{ id: 'i1', is_primary: true }] }, { image: { name: 'a.jpg', bytes: await photo() } })
    await s.run('propose_product_image', { product_id: P1, source: 'attached' })
    expect(s.cards[0].payload).toMatchObject({ main: false, image_count: 1 })
  })
  it('without an attached photo it asks for one', async () => {
    const s = setup({ products: [{ id: P1, name: 'Цинк' }] })
    const out = await s.run('propose_product_image', { product_id: P1, source: 'attached' })
    expect(out.error).toContain('няма прикачена снимка')
    expect(s.cards).toHaveLength(0)
  })
  it('a picture link inside a private network is refused', async () => {
    const s = setup({ products: [{ id: P1, name: 'Цинк' }] })
    const out = await s.run('propose_product_image', { product_id: P1, source: 'link', image_url: 'http://169.254.169.254/latest/meta-data' })
    expect(out.error).toContain('вътрешен адрес')
    expect(s.storage.files.size).toBe(0)
  })
  it('an unknown product is refused', async () => {
    const s = setup({ products: [] }, { image: { name: 'a.jpg', bytes: await photo() } })
    expect((await s.run('propose_product_image', { product_id: P1, source: 'attached' })).error).toContain('Няма продукт')
  })
})

describe('read_link', () => {
  it('refuses inside addresses and odd links with a plain reason', async () => {
    const s = setup({})
    expect((await s.run('read_link', { url: 'http://localhost/api/admin' })).error).toContain('вътрешен адрес')
    expect((await s.run('read_link', { url: 'file:///etc/passwd' })).error).toContain('http')
  })
})

describe('media tools', () => {
  it('never write to products or their photos themselves', () => {
    const src = MEDIA_TOOLS.map(t => t.run.toString()).join('\n')
    expect(src).not.toMatch(/from\('(products|product_images)'\)[^;]*\.(insert|update|upsert|delete)\(/)
    expect(src).not.toMatch(/\.rpc\(|email_settings/)
  })
})
