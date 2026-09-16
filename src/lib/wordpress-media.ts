/**
 * Uploads a product image into the WordPress media library.
 *
 * Every image is converted to JPEG first. The shop's media library contains
 * only JPEG and PNG across everything ever uploaded, and 46% of Prody's images
 * are AVIF — a format no one has successfully put there. Converting everything
 * is predictable; converting only the awkward formats is a guess about which
 * ones the server accepts.
 *
 * The bytes never touch the disk: fetched into a buffer, converted in memory,
 * posted onward. Nothing is left behind to clean up.
 */
import sharp from 'sharp'

const BASE = process.env.WOOCOMMERCE_URL
const WP_USER = process.env.WORDPRESS_USER
const WP_PASS = process.env.WORDPRESS_APP_PASSWORD

export function isWpMediaConfigured(): boolean {
  return Boolean(BASE && WP_USER && WP_PASS)
}

/** Largest edge we send. Shop images are displayed far smaller than this. */
const MAX_EDGE = 1600

/**
 * Largest source file we will read. Product photos run tens of kilobytes; the
 * biggest in the catalogue is under a megabyte. Without a ceiling, a single
 * oversized file is buffered whole and then copied, and the runtime dies of
 * memory exhaustion — which takes down the whole application, not one request.
 */
const MAX_BYTES = 12 * 1024 * 1024

/**
 * Hosts a product image may be fetched from.
 *
 * `product_images.url` is not always something an admin uploaded:
 * `/api/products/import` stores whatever `image_url` a caller supplies,
 * unvalidated. Without this list the push would turn that stored string into a
 * server-side fetch of any address the server can reach — including ones not
 * reachable from outside it.
 */
function isAllowedSource(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  const shop = process.env.WOOCOMMERCE_URL
  const shopHost = shop ? (() => { try { return new URL(shop).hostname } catch { return null } })() : null
  return url.hostname.endsWith('.supabase.co') || (shopHost !== null && url.hostname === shopHost)
}

export async function uploadImage(sourceUrl: string, filename: string): Promise<number> {
  if (!isWpMediaConfigured()) {
    throw new Error('WordPress не е настроен (липсват WORDPRESS_USER или WORDPRESS_APP_PASSWORD)')
  }

  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error('Адресът на снимката е невалиден')
  }

  if (!isAllowedSource(parsed)) {
    throw new Error('Снимката е от непознат адрес и не беше качена')
  }

  const src = await fetch(parsed, { signal: AbortSignal.timeout(15000) })
  if (!src.ok) {
    throw new Error(`Снимката не можа да се свали (${src.status})`)
  }

  // Trust the declared length when it is there, but verify after reading:
  // Content-Length is a claim, and a chunked response omits it entirely.
  const declared = Number(src.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error(`Снимката е твърде голяма (${Math.round(declared / 1024 / 1024)} MB)`)
  }

  const input = Buffer.from(await src.arrayBuffer())

  if (input.byteLength > MAX_BYTES) {
    throw new Error(`Снимката е твърде голяма (${Math.round(input.byteLength / 1024 / 1024)} MB)`)
  }

  const jpeg = await sharp(input)
    .rotate() // honour EXIF orientation before the metadata is dropped
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()

  const auth = 'Basic ' + Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64')

  const res = await fetch(`${BASE!.replace(/\/$/, '')}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: new Uint8Array(jpeg),
    signal: AbortSignal.timeout(18000),
  })

  const text = await res.text()

  if (!res.ok) {
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) detail = parsed.message
    } catch { /* keep the raw text */ }
    throw new Error(`WordPress отказа снимката (${res.status}): ${detail}`)
  }

  const media = JSON.parse(text) as { id?: number }
  if (!media.id) throw new Error('WordPress не върна id на снимката')
  return media.id
}
