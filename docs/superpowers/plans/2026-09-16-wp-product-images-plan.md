# Качване на продуктови снимки в WooCommerce

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** When a product is pushed to the shop, its primary image goes with it — converted to JPEG, uploaded once, never re-uploaded on later pushes.

**Architecture:** The push route fetches the primary image from Supabase Storage into memory, converts it with `sharp`, uploads it to the WordPress media library with the WordPress Application Password, and attaches the returned media id to the product. Nothing touches the disk.

**Tech Stack:** Next.js 16 route handler, `sharp` 0.34.5, WordPress REST `wp/v2/media`, WooCommerce REST `wc/v3/products`.

## Global Constraints

- Never touch production data beyond what a push writes. Staging DB is `ruhhsixmqusnpiajkbxe`; production is `ocvmqlbfkloskabicxuw`.
- Never write to the live shop (zonapharm.com) during implementation. Read-only GET is fine. The user runs every write.
- Credentials live in `.env.local` and Vercel only. Never in a file, a log, a response body, or the conversation.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- User-facing strings are Bulgarian.
- Never push to a remote or merge to main.

## User decisions (settled — do not revisit)

1. **Every format is converted to JPEG**, not only the problematic ones. Predictable output beats a branch per format. Source formats present: avif 341, jpg 211, png 114, webp 52, jpeg 18, jfif 2.
2. **Conversion happens in the Prody route, in memory.** Measured at 23 ms for a real 800×800 avif; 49 ms with a resize. No temporary files, so no artefacts are left anywhere.
3. **A product that already has an image on the shop is left alone.** The second push updates the text and skips the image entirely. Nothing is ever deleted — not from Prody, not from WordPress.
4. Only the **primary** image is sent. 720 of 729 products have one; multi-image products send only the primary.

## Observed facts this plan depends on

- `products/{id}` returns `images: [{ id, src, name, alt }]`. A product with no images returns `[]`.
- The media library holds only `image/jpeg` and `image/png` across 100 sampled items — no avif or webp has ever been uploaded. This is why conversion is not optional.
- The WordPress user is an administrator with `upload_files`.
- Supabase image URLs are public: a plain GET returns the bytes with no auth.
- 16 of 738 image rows already point at `zonapharm.com` rather than Supabase.

---

### Task 1: Declare sharp, and upload media to WordPress

**Files:**
- Modify: `package.json`
- Create: `src/lib/wordpress-media.ts`

**Interfaces:**
- Produces: `uploadImage(sourceUrl: string, filename: string): Promise<number>` returning the WordPress media id; `isWpMediaConfigured(): boolean`

- [ ] **Step 1: Declare sharp as a real dependency**

`sharp` is used by `src/app/api/reports/inventory-export/route.ts:7` today but appears nowhere in `package.json` — it resolves only because Next.js bundles it. That is a latent break: a Next.js upgrade that drops or moves it takes the Excel export down with no warning. Add it to `dependencies`, pinned to the version already installed:

```json
    "sharp": "0.34.5",
```

Insert it in alphabetical order among the existing dependencies. Do not run `npm install` — the package is already present at that exact version; adding the line only records the dependency.

- [ ] **Step 2: Write the media uploader**

Create `src/lib/wordpress-media.ts`:

```typescript
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

export async function uploadImage(sourceUrl: string, filename: string): Promise<number> {
  if (!isWpMediaConfigured()) {
    throw new Error('WordPress не е настроен (липсват WORDPRESS_USER или WORDPRESS_APP_PASSWORD)')
  }

  const src = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) })
  if (!src.ok) {
    throw new Error(`Снимката не можа да се свали (${src.status})`)
  }

  const input = Buffer.from(await src.arrayBuffer())

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
    signal: AbortSignal.timeout(60000),
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
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Verify sharp handles a real source image**

This is read-only against Supabase and uploads nothing. Convert one real AVIF and assert the output is a JPEG:

```bash
node -e "
const sharp=require('sharp');
fetch('https://ocvmqlbfkloskabicxuw.supabase.co/storage/v1/object/public/products/35478249-8f69-4463-932f-ead2c8328e63/1.avif')
 .then(r=>r.arrayBuffer())
 .then(b=>sharp(Buffer.from(b)).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85,mozjpeg:true}).toBuffer())
 .then(out=>sharp(out).metadata())
 .then(m=>console.log('output format:', m.format, m.width+'x'+m.height))
 .catch(e=>console.log('FAILED:', e.message));
"
```

Expected: `output format: jpeg 800x800`. Record the actual output in your report.

Do NOT upload anything to WordPress. The user runs the first real upload.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/wordpress-media.ts
git commit -m "feat: upload a product image to the WordPress media library

Converts every source format to JPEG in memory — the library has only ever
held JPEG and PNG, and 46% of Prody's images are AVIF. Nothing is written to
disk, so no artefacts are left behind.

Also declares sharp, which the Excel export has been importing without it
appearing in package.json.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Send the image with the push

**Files:**
- Modify: `src/app/api/products/[id]/push-to-wp/route.ts`
- Modify: `src/lib/woocommerce.ts`

**Interfaces:**
- Consumes: `uploadImage`, `isWpMediaConfigured` from Task 1
- Produces: `WooProductInput` gains `images?: { id: number }[]`

- [ ] **Step 0: Pin the route to the Node.js runtime**

At the top of `src/app/api/products/[id]/push-to-wp/route.ts`, after the
imports and before the handler:

```typescript
// sharp is a native module and only runs under Node.js, never the edge
// runtime. Next.js already picks Node.js for this route, but the choice is
// then implicit — and the image upload would fail in a way that looks like a
// WordPress problem rather than a runtime one.
export const runtime = 'nodejs'
export const maxDuration = 60
```

`maxDuration` covers the slow part, which is network rather than conversion:
fetching the image from Supabase and posting it to WordPress. Conversion itself
measured 49 ms. The existing Excel export sets 300 for the same reason at far
greater scale, so this ceiling is available on the current Vercel plan.

- [ ] **Step 1: Add images to the WooCommerce input type**

In `src/lib/woocommerce.ts`, add one field to `WooProductInput`:

```typescript
  images?: { id: number }[]
```

WooCommerce accepts either `{ id }` for an existing media item or `{ src }` for
a URL it should fetch itself. We use `id`, because the media item is uploaded
first and converted on our side.

- [ ] **Step 2: Read the primary image alongside the product**

In `src/app/api/products/[id]/push-to-wp/route.ts`, after the product is
fetched and the title check has passed, add:

```typescript
  // Only the primary image is sent. Most products have exactly one; the few
  // with several are not worth a gallery sync until someone asks for it.
  const { data: primaryImage } = await (admin.from('product_images') as any)
    .select('url')
    .eq('product_id', id)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle()
```

- [ ] **Step 3: Upload it, but only when the shop product has none**

Insert this immediately before the `payload` is built. It must come after
`existingId` is known, so move the `const existingId` line up out of the `try`
block if it is not already above this point:

```typescript
  // A product that already carries an image on the shop keeps it. Re-uploading
  // on every push would pile up duplicates in the media library, and the image
  // is the part least likely to have changed.
  let mediaId: number | null = null

  if (primaryImage?.url && isWpMediaConfigured()) {
    let shopHasImage = false

    if (existingId) {
      try {
        shopHasImage = await productHasImage(existingId)
      } catch {
        // If we cannot tell, assume it has one. Skipping an image is
        // recoverable by hand; a duplicate in the media library is litter.
        shopHasImage = true
      }
    }

    if (!shopHasImage) {
      try {
        mediaId = await uploadImage(primaryImage.url, `${title}.jpg`)
      } catch (imgErr: any) {
        // The copy is worth more than the picture: a failed image must not
        // block the push. The product goes up without it and the operator is
        // told, rather than the whole push failing.
        imageWarning = imgErr?.message || 'Снимката не можа да се качи'
      }
    }
  }
```

Declare `let imageWarning: string | null = null` beside `mediaId`.

- [ ] **Step 4: Add the image to the payload**

In the `payload` object, alongside the existing spreads:

```typescript
    ...(mediaId ? { images: [{ id: mediaId }] } : {}),
```

- [ ] **Step 5: Add the helper that asks whether the shop product has an image**

In `src/lib/woocommerce.ts`:

```typescript
/** Whether the shop product already carries at least one image. */
export async function productHasImage(id: number): Promise<boolean> {
  if (!isWooConfigured()) return false

  const res = await fetch(
    `${BASE!.replace(/\/$/, '')}/wp-json/wc/v3/products/${id}?_fields=images`,
    { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(20000) },
  )

  if (!res.ok) throw new Error(`WooCommerce отказа (${res.status})`)

  const body = await res.json() as { images?: unknown[] }
  return Array.isArray(body.images) && body.images.length > 0
}
```

- [ ] **Step 6: Report the warning to the operator**

In the success response, add the warning so a missing image is visible rather
than silent:

```typescript
    return NextResponse.json({
      success: true,
      wp_product_id: result.id,
      permalink: result.permalink,
      created: !existingId,
      ...(imageWarning ? { warning: imageWarning } : {}),
    })
```

- [ ] **Step 7: Show it in the button**

In `src/components/products/push-to-wp-button.tsx`, when the response carries
`warning`, surface it next to the success state in Bulgarian — the push
succeeded, the image did not. Follow the component's existing message pattern;
do not introduce a new notification mechanism.

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add "src/app/api/products/[id]/push-to-wp/route.ts" src/lib/woocommerce.ts src/components/products/push-to-wp-button.tsx
git commit -m "feat: send the primary product image with the push

Uploaded once: a product that already has an image on the shop keeps it, so
repeat pushes update the copy without piling up duplicates in the media
library. A failed image warns instead of failing the whole push.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Out of scope

Galleries (only the primary image is sent), alt text, image SEO, replacing an
image that changed in Prody, removing images from the shop, and the 16 image
rows that already point at zonapharm.com rather than Supabase — those need no
upload and the existing code path handles them as ordinary URLs.

## Deployment

Nothing here deploys itself. `main` auto-deploys, so this work stays on
`feat/wp-images` until the user decides.

Two new environment variables must reach Vercel Production **before** the code
does, or every push logs an image failure while still succeeding:

```
WORDPRESS_USER
WORDPRESS_APP_PASSWORD
```

Neither is `NEXT_PUBLIC_`. The application password grants write access to the
media library.

No migration. No schema change. Nothing to roll back in the database.
