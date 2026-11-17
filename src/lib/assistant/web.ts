/**
 * Opening a link the person gave the assistant: a product page, or a picture.
 *
 * The server fetches it, so the address is checked first: only http(s) on the
 * usual ports, no user:password, and never an address inside a private
 * network (the server's own, Vercel's, a router's). The check is made on the
 * address the name actually resolves to, at connect time, and again after
 * every redirect, so a name that points inside cannot slip through. Size and
 * time are capped. What comes back is data for the model to read, never
 * instructions.
 */
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'

export class WebError extends Error {}

const blocked = new net.BlockList()
for (const [ip, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(ip, bits, 'ipv4')
for (const [ip, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64],
  ['2001::', 32], ['2002::', 16],
] as const) blocked.addSubnet(ip, bits, 'ipv6')

/** An IPv4 address hidden in an IPv6 one (::ffff:10.0.0.1, 64:ff9b::a00:1). */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (m) return m[1]
  const h = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip)
  if (h) {
    const a = parseInt(h[1], 16), b = parseInt(h[2], 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return null
}

/** True only for an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return !blocked.check(ip, 'ipv4')
  if (v === 6) {
    const v4 = embeddedV4(ip)
    if (v4) return isPublicAddress(v4)
    return !blocked.check(ip, 'ipv6')
  }
  return false
}

/** The link as the server may open it, or the reason it may not. */
export function checkUrl(raw: string, anyPort = false, allow: (ip: string) => boolean = isPublicAddress): URL {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new WebError('Това не е валиден линк.') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WebError('Отварям само http(s) линкове.')
  if (url.username || url.password) throw new WebError('Линк с име и парола не се отваря.')
  if (!anyPort && url.port && url.port !== '80' && url.port !== '443') throw new WebError('Линкът е към необичаен порт.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes('.') && !net.isIP(host)) {
    throw new WebError('Линкът е към вътрешен адрес.')
  }
  if (net.isIP(host) && !allow(host)) throw new WebError('Линкът е към вътрешен адрес.')
  return url
}

export type WebResponse = { url: string; status: number; contentType: string; body: Buffer }

export type FetchOptions = {
  maxBytes?: number
  timeoutMs?: number
  accept?: string
  /** Tests only: a local test server (any address, any port). */
  testing?: { allowAddress: (ip: string) => boolean; anyPort: boolean }
}

const MAX_REDIRECTS = 4

/** The name is resolved here and every address checked, so the connection can only go to a public one. */
function guardedLookup(allow: (ip: string) => boolean) {
  return (hostname: string, options: any, callback: any) => {
    const cb = typeof options === 'function' ? options : callback
    const opts = typeof options === 'function' ? {} : (options ?? {})
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses: any) => {
      if (err) return cb(err)
      const list = (addresses as dns.LookupAddress[]) || []
      if (!list.length || list.some(a => !allow(a.address))) {
        return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }))
      }
      if (opts.all) return cb(null, list)
      cb(null, list[0].address, list[0].family)
    })
  }
}

function once(url: URL, o: Required<Pick<FetchOptions, 'maxBytes' | 'timeoutMs' | 'accept'>> & { allow: (ip: string) => boolean }, deadline: number):
  Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, {
      method: 'GET',
      lookup: guardedLookup(o.allow) as any,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Prody/1.0)',
        Accept: o.accept,
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'bg,en;q=0.8',
      },
      timeout: Math.max(1, deadline - Date.now()),
    }, res => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, headers: res.headers, body: Buffer.alloc(0) }) }
      const declared = Number(res.headers['content-length'] || 0)
      if (declared > o.maxBytes) { res.destroy(); return reject(new WebError('Страницата е твърде голяма.')) }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase()
      const stream: NodeJS.ReadableStream =
        enc === 'gzip' ? res.pipe(zlib.createGunzip()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) :
        enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res
      const chunks: Buffer[] = []
      let size = 0
      stream.on('data', (c: Buffer) => {
        size += c.length
        if (size > o.maxBytes) { req.destroy(); reject(new WebError('Страницата е твърде голяма.')); return }
        chunks.push(c)
      })
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }))
      stream.on('error', () => reject(new WebError('Страницата не можа да се прочете.')))
    })
    const timer = setTimeout(() => req.destroy(new WebError('Страницата не отговори навреме.')), Math.max(1, deadline - Date.now()))
    req.on('timeout', () => req.destroy(new WebError('Страницата не отговори навреме.')))
    req.on('error', (err: any) => {
      if (err instanceof WebError) return reject(err)
      if (err?.code === 'EBLOCKED') return reject(new WebError('Линкът е към вътрешен адрес.'))
      if (err?.code === 'ENOTFOUND') return reject(new WebError('Няма такъв сайт.'))
      reject(new WebError('Линкът не се отваря.'))
    })
    req.on('close', () => clearTimeout(timer))
    req.end()
  })
}

/** Opens a public link, following up to four redirects, each one checked again. */
export async function safeFetch(raw: string, opts: FetchOptions = {}): Promise<WebResponse> {
  const o = {
    maxBytes: opts.maxBytes ?? 3 * 1024 * 1024,
    timeoutMs: opts.timeoutMs ?? 12_000,
    accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
    allow: opts.testing?.allowAddress ?? isPublicAddress,
  }
  const deadline = Date.now() + o.timeoutMs
  const anyPort = !!opts.testing?.anyPort
  let url = checkUrl(raw, anyPort, o.allow)
  for (let hop = 0; ; hop++) {
    const res = await once(url, o, deadline)
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.location
      if (!next || hop >= MAX_REDIRECTS) throw new WebError('Линкът пренасочва твърде много пъти.')
      url = checkUrl(new URL(next, url).toString(), anyPort, o.allow)
      continue
    }
    if (res.status === 404 || res.status === 410) throw new WebError('Страницата я няма (грешка ' + res.status + ').')
    if (res.status < 200 || res.status >= 300) throw new WebError(`Сайтът не отвори страницата (грешка ${res.status}).`)
    return { url: url.toString(), status: res.status, contentType: String(res.headers['content-type'] || ''), body: res.body }
  }
}

// ---------------------------------------------------------------------------
// What a product page says.
// ---------------------------------------------------------------------------

export type PageInfo = {
  url: string
  title: string | null
  description: string | null
  product: { name?: string; description?: string; brand?: string; gtin?: string; sku?: string; price?: string; currency?: string } | null
  images: string[]
  text: string
  truncated: boolean
}

export const MAX_PAGE_TEXT = 12_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim() : null
}

function meta(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase()
    if (keys.includes(key)) {
      const v = attr(tag, 'content')
      if (v) return v
    }
  }
  return null
}

function absolute(src: string | null | undefined, base: string): string | null {
  if (!src) return null
  try {
    const u = new URL(src, base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch { return null }
}

function clean(s: unknown, max = 2000): string | undefined {
  if (typeof s !== 'string') return undefined
  const t = decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : undefined
}

/** The Product block from the page's schema.org JSON-LD, if it has one. */
function jsonLdProduct(html: string): { info: PageInfo['product']; images: unknown[] } {
  const found: any[] = []
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim())
      const walk = (x: any) => {
        if (!x || typeof x !== 'object') return
        if (Array.isArray(x)) return x.forEach(walk)
        const t = x['@type']
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) found.push(x)
        if (x['@graph']) walk(x['@graph'])
      }
      walk(data)
    } catch { /* a broken block is skipped */ }
  }
  const p = found[0]
  if (!p) return { info: null, images: [] }
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers
  const brand = typeof p.brand === 'string' ? p.brand : p.brand?.name
  const info = {
    name: clean(p.name, 300),
    description: clean(p.description, 4000),
    brand: clean(brand, 200),
    gtin: clean(p.gtin13 ?? p.gtin ?? p.gtin8 ?? p.gtin12 ?? p.gtin14, 40),
    sku: clean(p.sku, 100),
    price: offer?.price != null ? String(offer.price).slice(0, 30) : offer?.lowPrice != null ? String(offer.lowPrice).slice(0, 30) : undefined,
    currency: clean(offer?.priceCurrency, 10),
  }
  const images = Array.isArray(p.image) ? p.image : p.image ? [p.image] : []
  return { info, images: images.map((i: any) => (typeof i === 'string' ? i : i?.url)) }
}

/** Title, description, product data, pictures and the readable text of a page. */
export function readPage(html: string, url: string): PageInfo {
  const ld = jsonLdProduct(html)
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const images = [
    ...ld.images,
    meta(html, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']),
    ...[...html.matchAll(/<img\b[^>]*>/gi)].map(m => attr(m[0], 'data-large_image') || attr(m[0], 'data-src') || attr(m[0], 'src'))
      .filter(s => s && !/\.svg(\?|$)|logo|icon|sprite|placeholder|pixel|data:/i.test(s)),
  ].map(s => absolute(s as string, url)).filter((s): s is string => !!s)
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template|head|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body).replace(/[ \t\f\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    url,
    title: clean(meta(html, ['og:title']) ?? titleTag, 300) ?? null,
    description: clean(meta(html, ['og:description', 'description', 'twitter:description']), 2000) ?? null,
    product: ld.info,
    images: [...new Set(images)].slice(0, 6),
    text: text.slice(0, MAX_PAGE_TEXT),
    truncated: text.length > MAX_PAGE_TEXT,
  }
}

/** Decodes the page in its own charset (most are UTF-8; some older Bulgarian ones are windows-1251). */
export function pageText(body: Buffer, contentType: string): string {
  const head = body.subarray(0, 4096).toString('latin1')
  const charset = (/charset=([\w-]+)/i.exec(contentType)?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] || 'utf-8').toLowerCase()
  try { return new TextDecoder(charset).decode(body) } catch { return new TextDecoder('utf-8').decode(body) }
}

/** Opens a product page and returns what it says about the product. */
export async function fetchPage(raw: string, opts: FetchOptions = {}): Promise<PageInfo> {
  const res = await safeFetch(raw, opts)
  if (!/html|xml|text\/plain/i.test(res.contentType) && res.contentType) {
    if (/^image\//i.test(res.contentType)) return { url: res.url, title: null, description: null, product: null, images: [res.url], text: '', truncated: false }
    throw new WebError('Линкът не е към страница (а към файл). Свалете файла и го прикачете.')
  }
  return readPage(pageText(res.body, res.contentType), res.url)
}

/** Downloads a picture from a public link. */
export async function fetchImage(raw: string, opts: FetchOptions = {}): Promise<Buffer> {
  const res = await safeFetch(raw, { maxBytes: 15 * 1024 * 1024, accept: 'image/*', ...opts })
  if (res.contentType && !/^image\//i.test(res.contentType) && !/octet-stream/i.test(res.contentType)) {
    throw new WebError('Линкът не е към снимка.')
  }
  return res.body
}
