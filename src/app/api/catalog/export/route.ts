import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProducts } from '@/lib/db/products'
import { getStores } from '@/lib/db/stores'
import * as XLSX from 'xlsx'

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

  // Aggregate stock per product per store
  const stockMap: Record<string, Record<string, number>> = {}
  storeBatches.forEach((b: any) => {
    const storeName = b.store?.name || '—'
    if (!stockMap[b.product_id]) stockMap[b.product_id] = {}
    stockMap[b.product_id][storeName] = (stockMap[b.product_id][storeName] || 0) + b.quantity_remaining
  })

  const storeNames = activeStores.map((s: any) => s.name)

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

  const rows = (products || []).map((p: any) => {
    const stock = stockMap[p.id] || {}
    const totalStock = Object.values(stock).reduce((sum: number, q: number) => sum + q, 0)
    const primaryImage = p.images?.find((i: any) => i.is_primary) || p.images?.[0]

    return [
      p.source_order_date || '',
      p.name || '',
      primaryImage?.url || '',
      p.description || '',
      totalStock,
      p.cost_price ?? '',
      p.price ?? '',
      p.source_url || '',
      ...storeNames.map((name) => stock[name] || 0),
    ]
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!autofilter'] = { ref: ws['!ref'] || 'A1' }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Каталог')

  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="catalog-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
