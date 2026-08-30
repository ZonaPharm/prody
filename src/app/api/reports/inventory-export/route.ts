import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAll, fetchByIds } from '@/lib/fetch-all'
import { buildInventoryWorkbook, type InventoryRow, type InventoryStore } from '@/lib/export-inventory'
import { sofiaToday } from '@/lib/date-utils'
import sharp from 'sharp'

export const maxDuration = 300

type ProductRow = {
  id: string
  name: string
  min_quantity: number | null
}

// Excel only understands png/jpeg/gif, and over half the catalogue is stored as
// avif or webp, so everything is re-encoded to png. Downscaling to thumbnail
// size at the same time is what keeps the workbook from ballooning.
async function loadImage(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const source = Buffer.from(await res.arrayBuffer())
    const buffer = await sharp(source)
      .resize(112, 112, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer()
    return { buffer, extension: 'png' as const }
  } catch {
    // A missing, slow or undecodable image must not fail the whole export.
    return null
  }
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const includeImages = searchParams.get('images') !== '0'
  const includeInactive = searchParams.get('all') === '1'

  const admin = createAdminClient()

  const stores = await fetchAll<InventoryStore>(() => (admin.from('stores') as any)
    .select('id, name').order('name'))

  const products = await fetchAll<ProductRow>(() => {
    let q = (admin.from('products') as any)
      .select('id, name, min_quantity')
      .order('name').order('id')
    if (!includeInactive) q = q.eq('status', 'active')
    return q
  })

  const productIds = products.map(p => p.id)

  // Per-store stock comes from the batches, which is the only place it is
  // broken down; products.quantity_on_hand is a running total kept alongside.
  const batches = await fetchByIds<{ product_id: string; store_id: string; quantity_remaining: number }>(
    ids => (admin.from('stock_batches') as any)
      .select('product_id, store_id, quantity_remaining')
      .in('product_id', ids)
      .gt('quantity_remaining', 0),
    productIds,
  )

  const perProduct: Record<string, Record<string, number>> = {}
  for (const b of batches) {
    if (!perProduct[b.product_id]) perProduct[b.product_id] = {}
    const bucket = perProduct[b.product_id]
    bucket[b.store_id] = (bucket[b.store_id] || 0) + b.quantity_remaining
  }

  const images = includeImages
    ? await fetchByIds<{ product_id: string; url: string; is_primary: boolean; sort_order: number }>(
        ids => (admin.from('product_images') as any)
          .select('product_id, url, is_primary, sort_order')
          .in('product_id', ids)
          .order('is_primary', { ascending: false })
          .order('sort_order'),
        productIds,
      )
    : []

  const primaryImage: Record<string, string> = {}
  for (const img of images) {
    if (!primaryImage[img.product_id]) primaryImage[img.product_id] = img.url
  }

  const rows: InventoryRow[] = products.map(p => {
    const perStore = perProduct[p.id] || {}
    const batchTotal = Object.values(perStore).reduce((a, b) => a + b, 0)
    return {
      id: p.id,
      name: p.name,
      min_quantity: p.min_quantity ?? 0,
      perStore,
      batchTotal,
      imageUrl: primaryImage[p.id] || null,
    }
  })

  try {
    const buffer = await buildInventoryWorkbook(rows, stores, includeImages ? loadImage : null)
    const filename = `nalichnosti-${sofiaToday()}.xlsx`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}
