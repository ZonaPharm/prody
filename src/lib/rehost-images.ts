/**
 * Moves product images that live on someone else's server into Prody's own
 * storage.
 *
 * 16 products imported on 6 May 2026 still load their picture straight from
 * zonapharm.com, while every other image is in Supabase Storage. The browser
 * fetches those 16 from the shop directly, so whether they appear depends on
 * the shop's server, its security rules, and the visitor's network — and for
 * one user some of them stopped appearing, while the same URLs loaded fine
 * from everywhere else. Hosting them ourselves removes that dependency.
 *
 * Takes the Supabase client as a parameter and imports nothing from the app,
 * so it can be exercised against staging from a plain script.
 */
import sharp from 'sharp'

const BUCKET = 'products'
const MAX_BYTES = 15 * 1024 * 1024
const MAX_EDGE = 1600
const CONCURRENCY = 3

export type ExternalImage = {
  id: string
  product_id: string
  url: string
}

export type RehostResult = {
  imageId: string
  productId: string
  oldUrl: string
  newUrl?: string
  bytesBefore?: number
  bytesAfter?: number
  error?: string
}

/** Same test the catalogue uses to decide a URL is ours: src/lib/images.ts. */
export function isExternalImageUrl(url: string | null | undefined): boolean {
  return Boolean(url) && !/\/storage\/v1\/object\/public\//.test(url as string)
}

export async function findExternalImages(admin: any): Promise<ExternalImage[]> {
  const out: ExternalImage[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from('product_images')
      .select('id, product_id, url')
      .order('id')
      .range(offset, offset + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []).filter((r: ExternalImage) => isExternalImageUrl(r.url)))
    if (!data || data.length < 1000) return out
  }
}

async function rehostOne(admin: any, image: ExternalImage): Promise<RehostResult> {
  const result: RehostResult = { imageId: image.id, productId: image.product_id, oldUrl: image.url }

  try {
    const source = new URL(image.url)
    if (source.protocol !== 'https:') throw new Error('адресът не е https')

    const res = await fetch(source, {
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'Prody/1.0' },
    })
    if (!res.ok) throw new Error(`изходната снимка върна ${res.status}`)

    const input = Buffer.from(await res.arrayBuffer())
    if (input.byteLength > MAX_BYTES) throw new Error('снимката е твърде голяма')
    result.bytesBefore = input.byteLength

    // WebP rather than JPEG: several of these are product shots on a
    // transparent background, and JPEG would paint that black. Some are also
    // print-sized — one is 2953x3543 and 2.7 MB for a thumbnail — so they are
    // brought down to a size the catalogue can actually use.
    const output = await sharp(input)
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer()
    result.bytesAfter = output.byteLength

    // Named after the image row, so running this twice overwrites the same
    // file instead of leaving a second copy.
    const path = `${image.product_id}/rehosted-${image.id}.webp`

    const { error: uploadError } = await admin.storage.from(BUCKET)
      .upload(path, output, { contentType: 'image/webp', upsert: true })
    if (uploadError) throw new Error(`качването не мина: ${uploadError.message}`)

    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path)
    const newUrl: string = urlData.publicUrl

    // Prove the new copy is really served before pointing the product at it.
    // If this fails the row keeps its old address and nothing is lost.
    const check = await fetch(newUrl, { signal: AbortSignal.timeout(15000) })
    if (!check.ok) throw new Error(`новото копие не се отваря (${check.status})`)

    // Only if the row still holds the address we copied from — someone may
    // have replaced the image in the meantime.
    const { data: updated, error: updateError } = await admin.from('product_images')
      .update({ url: newUrl })
      .eq('id', image.id)
      .eq('url', image.url)
      .select('id')
    if (updateError) throw new Error(`записът в базата не мина: ${updateError.message}`)
    if (!updated || updated.length === 0) throw new Error('снимката е била сменена междувременно')

    result.newUrl = newUrl
  } catch (err: any) {
    result.error = err?.message || 'неизвестна грешка'
  }

  return result
}

/** Rehosts every external image. Never throws for a single image's failure. */
export async function rehostExternalImages(admin: any): Promise<RehostResult[]> {
  const images = await findExternalImages(admin)
  const results: RehostResult[] = []

  // A few at a time: enough to finish quickly, few enough not to look like an
  // attack to the server the images come from.
  for (let i = 0; i < images.length; i += CONCURRENCY) {
    const batch = images.slice(i, i + CONCURRENCY)
    results.push(...await Promise.all(batch.map(img => rehostOne(admin, img))))
  }

  return results
}
