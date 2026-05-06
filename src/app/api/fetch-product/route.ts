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
      const regex = new RegExp(
        `<meta[^>]+property=["']${escapeRegex(property)}["'][^>]+content=["']([^"']*)["']`,
        'i'
      )
      const match = html.match(regex)
      return match ? match[1] : null
    }

    const getMetaName = (name: string): string | null => {
      const regex = new RegExp(
        `<meta[^>]+name=["']${escapeRegex(name)}["'][^>]+content=["']([^"']*)["']`,
        'i'
      )
      const match = html.match(regex)
      return match ? match[1] : null
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
    const jsonLdMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const inner = match.replace(/<[^>]+>/g, '')
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
