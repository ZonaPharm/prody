import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const url = body.url

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL е задължително поле' }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
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

    const title =
      getMeta('og:title') ||
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
      null

    const image = getMeta('og:image')

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

    return NextResponse.json({ title, image, price })
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
