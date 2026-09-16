/**
 * Bulgarian Cyrillic to Latin, for shop URLs and uploaded file names.
 *
 * Two things need this. WordPress builds a product's URL from its title, and
 * a Cyrillic title becomes a percent-encoded URL that is unreadable and
 * unshareable. And an upload's file name travels in an HTTP header, where only
 * ASCII is allowed — a Cyrillic name makes the request illegal, which is what
 * broke the first image push.
 *
 * The mapping follows what the shop's own editors already do by hand, measured
 * across the 62 Latin-slugged products on the shop rather than assumed:
 *
 *   ц → c    (6 of 6 — led-maska-za-lice, maska-s-niacinamid-sadoer)
 *   щ → sht  (4 of 5 — hidratirashta-maska-s-biokolagen)
 *
 * The official streamlined system renders ц as "ts", which would have produced
 * led-maska-za-litse — correct by the standard, and unlike every URL the shop
 * already has. Consistency with the existing catalogue matters more here.
 */

const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch',
  ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
}

/** Cyrillic to Latin, letter by letter. Anything already Latin is untouched. */
export function transliterate(input: string): string {
  let out = ''
  for (const ch of input) {
    const lower = ch.toLowerCase()
    const mapped = MAP[lower]
    if (mapped === undefined) {
      out += ch
      continue
    }
    // Preserve the case of the source letter: Ч becomes Ch, not CH.
    out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1)
  }
  return out
}

/**
 * A URL-safe slug: transliterated, lowercased, punctuation collapsed to single
 * hyphens. Matches the shape of the slugs the shop already uses.
 */
export function slugify(input: string): string {
  return transliterate(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents left by other alphabets
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) // WordPress slugs are not unbounded; leave room for its own suffixes
}

/**
 * An ASCII file name safe to put in a Content-Disposition header.
 * Falls back to a fixed name when a title transliterates to nothing —
 * a title of only emoji or punctuation would otherwise yield ".jpg".
 */
export function asciiFilename(title: string, extension = 'jpg'): string {
  const base = slugify(title).slice(0, 100)
  return `${base || 'product'}.${extension}`
}
