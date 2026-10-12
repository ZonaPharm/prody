import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findExternalImages, rehostExternalImages } from '@/lib/rehost-images'
import { logAction } from '@/lib/audit'

// sharp is native and needs Node.js; the work is network-bound, so allow time.
export const runtime = 'nodejs'
export const maxDuration = 300

async function requireAdminUser() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user }
}

/** How many product images still load from someone else's server. Reads only. */
export async function GET() {
  const auth = await requireAdminUser()
  if (auth.error) return auth.error

  try {
    const images = await findExternalImages(createAdminClient())
    const hosts = [...new Set(images.map(i => {
      try { return new URL(i.url).hostname } catch { return 'невалиден адрес' }
    }))]
    return NextResponse.json({ count: images.length, hosts })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Грешка' }, { status: 500 })
  }
}

/** Copies them into Prody's storage and repoints the products. */
export async function POST() {
  const auth = await requireAdminUser()
  if (auth.error) return auth.error

  try {
    const admin = createAdminClient()
    const results = await rehostExternalImages(admin)
    const moved = results.filter(r => r.newUrl).length
    const failed = results.filter(r => r.error)

    await logAction({
      action: 'rehost_images',
      userId: auth.user!.id,
      entityType: 'product_image',
      details: `Преместени ${moved} от ${results.length} външни снимки`,
    }, admin)

    return NextResponse.json({
      moved,
      failed: failed.length,
      errors: failed.map(f => ({ url: f.oldUrl, error: f.error })),
      savedKb: Math.round(results.reduce((s, r) => s + ((r.bytesBefore || 0) - (r.bytesAfter || 0)), 0) / 1024),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Грешка при преместване' }, { status: 500 })
  }
}
