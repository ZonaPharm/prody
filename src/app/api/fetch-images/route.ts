import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { urls } = await request.json()

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'Няма URL-та на изображения' }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()
    const results: { url: string; path: string; error?: string }[] = []

    for (const imageUrl of urls) {
      try {
        const imageResponse = await fetch(imageUrl, {
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'Prody/1.0' },
        })

        if (!imageResponse.ok) {
          results.push({ url: imageUrl, path: '', error: `HTTP ${imageResponse.status}` })
          continue
        }

        const contentType = imageResponse.headers.get('content-type') || ''
        if (!contentType.startsWith('image/')) {
          results.push({ url: imageUrl, path: '', error: 'not an image' })
          continue
        }

        const buffer = await imageResponse.arrayBuffer()
        const ext = contentType.split('/')[1] || 'jpg'
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(filename, Buffer.from(buffer), {
            contentType,
            upsert: false,
          })

        if (uploadError) {
          results.push({ url: imageUrl, path: '', error: uploadError.message })
          continue
        }

        const { data: urlData } = supabase.storage
          .from('products')
          .getPublicUrl(filename)

        results.push({ url: urlData.publicUrl, path: filename })
      } catch (err) {
        results.push({
          url: imageUrl,
          path: '',
          error: err instanceof Error ? err.message : 'download failed',
        })
      }
    }

    return NextResponse.json({ images: results })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Грешка при изтегляне на изображения' },
      { status: 500 }
    )
  }
}
