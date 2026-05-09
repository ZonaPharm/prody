import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProducts } from '@/lib/db/products'
import { getStores } from '@/lib/db/stores'
import ExcelJS from 'exceljs'

const IMG_ROW_HEIGHT = 80
const IMG_HEIGHT = 65

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const filters = {
    search: searchParams.get('search') || undefined,
    status: searchParams.get('status') || undefined,
    hasImages: searchParams.get('hasImages') || undefined,
  }

  const [products, stores] = await Promise.all([
    getProducts(filters),
    getStores(),
  ])

  const activeStores = (stores || []).filter((s: any) => s.is_active !== false)
  const storeNames = activeStores.map((s: any) => s.name)

  const productIds = (products || []).map((p: any) => p.id)
  let storeBatches: any[] = []
  if (productIds.length > 0) {
    const admin = createAdminClient()
    const { data } = await (admin.from('stock_batches') as any)
      .select('product_id, quantity_remaining, store:stores(name)')
      .in('product_id', productIds)
      .order('store(name)')
    storeBatches = data || []
  }

  const stockMap: Record<string, Record<string, number>> = {}
  storeBatches.forEach((b: any) => {
    const storeName = b.store?.name || '—'
    if (!stockMap[b.product_id]) stockMap[b.product_id] = {}
    stockMap[b.product_id][storeName] = (stockMap[b.product_id][storeName] || 0) + b.quantity_remaining
  })

  // Download images in parallel
  const imageBuffers: Record<string, Buffer | null> = {}
  const imageDownloads = (products || []).map(async (p: any) => {
    const img = p.images?.find((i: any) => i.is_primary) || p.images?.[0]
    if (!img?.url) return
    try {
      const res = await fetch(img.url, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const blob = await res.arrayBuffer()
        imageBuffers[p.id] = Buffer.from(blob)
      }
    } catch {
      // skip failed images
    }
  })
  await Promise.all(imageDownloads)

  // Build workbook
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Каталог')

  const headers = [
    'Дата на поръчка',
    'Име на продукта',
    'Снимка',
    'Описание',
    'Общо количество',
    'Покупна цена',
    'Продажна цена',
    'Линк',
    ...storeNames,
  ]

  // Header row
  const headerRow = ws.addRow(headers)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  }

  // Set column widths
  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 28
  ws.getColumn(3).width = 14
  ws.getColumn(4).width = 36
  ws.getColumn(5).width = 14
  ws.getColumn(6).width = 12
  ws.getColumn(7).width = 12
  ws.getColumn(8).width = 30
  storeNames.forEach((_, i) => {
    ws.getColumn(9 + i).width = 12
  })

  // Data rows
  for (const p of (products || []) as any[]) {
    const stock = stockMap[p.id] || {}
    const totalStock = Object.values(stock).reduce((sum: number, q: number) => sum + q, 0)
    const img = p.images?.find((i: any) => i.is_primary) || p.images?.[0]

    const rowValues: any[] = [
      p.source_order_date || '',
      p.name || '',
      '',
      p.description || '',
      totalStock,
      p.cost_price ?? '',
      p.price ?? '',
      p.source_url || '',
      ...storeNames.map((name) => stock[name] || 0),
    ]

    const row = ws.addRow(rowValues)
    row.height = IMG_ROW_HEIGHT

    // Embed image
    const imgBuf = imageBuffers[p.id]
    if (imgBuf) {
      try {
        const ext = img?.url?.match(/\.(\w+)(?:\?|$)/)?.[1]?.toLowerCase()
        const imgType = ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : 'jpeg'
        const imgId = wb.addImage({
          buffer: imgBuf as any,
          extension: imgType as 'png' | 'jpeg' | 'gif',
        })
        ws.addImage(imgId, {
          tl: { col: 2, row: row.number - 1 } as any,
          br: { col: 2.9, row: (row.number - 1) + IMG_HEIGHT / IMG_ROW_HEIGHT } as any,
          editAs: 'oneCell',
        })
      } catch {
        // skip failed image embed
      }
    }
  }

  // Autofilter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 8 + storeNames.length },
  }

  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="catalog-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
