import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const url = body.url

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL е задължително поле' }, { status: 400 })
    }

    let parsed: URL
    try { parsed = new URL(url) } catch {
      return NextResponse.json({ error: 'Невалиден URL адрес' }, { status: 422 })
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Позволени са само http и https адреси' }, { status: 422 })
    }

    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Prody/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Страницата върна статус ${response.status}` },
        { status: 422 }
      )
    }

    const html = await response.text()

    const getMeta = (property: string): string | null => {
      const tagRegex = new RegExp(
        `<meta[^>]+property=["']${escapeRegex(property)}["'][^>]*>`,
        'i'
      )
      const tagMatch = html.match(tagRegex)
      if (!tagMatch) return null
      const contentMatch = tagMatch[0].match(/content=["']([^"']*)["']/i)
      return contentMatch ? contentMatch[1] : null
    }

    const getMetaName = (name: string): string | null => {
      const tagRegex = new RegExp(
        `<meta[^>]+name=["']${escapeRegex(name)}["'][^>]*>`,
        'i'
      )
      const tagMatch = html.match(tagRegex)
      if (!tagMatch) return null
      const contentMatch = tagMatch[0].match(/content=["']([^"']*)["']/i)
      return contentMatch ? contentMatch[1] : null
    }

    // Title
    const title =
      getMeta('og:title') ||
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
      null

    // Description
    const description =
      getMeta('og:description') ||
      getMetaName('description') ||
      null

    // Images
    const images: string[] = []
    const ogImage = getMeta('og:image')
    if (ogImage) images.push(ogImage)

    // Parse JSON-LD for additional images
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let jsonLdMatch
    while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const inner = jsonLdMatch[1]
        const data = JSON.parse(inner)
        const product = data['@graph']?.find?.((g: any) => g['@type'] === 'Product') ||
                       (data['@type'] === 'Product' ? data : null)
        if (product?.image) {
          const imgs = Array.isArray(product.image) ? product.image : [product.image]
          for (const img of imgs) {
            if (typeof img === 'string' && !images.includes(img)) images.push(img)
            if (typeof img === 'object' && img.url && !images.includes(img.url)) images.push(img.url)
          }
        }
      } catch { /* skip invalid JSON-LD */ }
    }

    // Extract images from HTML <img> tags
    const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let imgMatch
    const nonProductPatterns = /icon|logo|avatar|banner|pixel|tracking|favicon|badge|button|placeholder|sprite|transparent|blank|loader|spinner|arrow|close|menu|search|share|social/i
    while ((imgMatch = imgTagRegex.exec(html)) !== null) {
      try {
        const src = imgMatch[1]
        if (nonProductPatterns.test(src)) continue
        const resolved = new URL(src, parsed.toString()).toString()
        if (!images.includes(resolved)) images.push(resolved)
        if (images.length >= 15) break
      } catch { /* skip invalid URLs */ }
    }

    // Price
    let price: number | null = null
    const ogPrice = getMeta('product:price:amount')
    if (ogPrice) {
      const parsedPrice = parseFloat(ogPrice)
      if (!isNaN(parsedPrice)) price = parsedPrice
    }
    if (price === null) {
      const priceMatch = html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/)
      if (priceMatch) {
        const parsedPrice = parseFloat(priceMatch[1])
        if (!isNaN(parsedPrice)) price = parsedPrice
      }
    }

    return NextResponse.json({ title, description, images, price })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Неуспешно извличане' },
      { status: 422 }
    )
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
