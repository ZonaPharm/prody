import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildExportWorkbook } from '@/lib/export-reports'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { type, from, to, store_id } = body

  if (!type || !from || !to) {
    return NextResponse.json({ error: 'Липсват задължителни полета' }, { status: 400 })
  }

  const admin = createAdminClient()

  const fetchSales = async (q: { from: string; to: string; store_id?: string | null }) => {
    let query = (admin.from('sales') as any)
      .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users!sales_sold_by_fkey(display_name)')
      .gte('sale_date', q.from)
      .lte('sale_date', q.to)
      .eq('voided', false)
      .order('sale_date', { ascending: false })
    if (q.store_id) query = query.eq('store_id', q.store_id)
    const { data } = await query

    // Fetch categories separately (category is nested under products)
    const productIds = [...new Set((data || []).map((s: any) => s.product_id))]
    const { data: prods } = productIds.length > 0
      ? await (admin.from('products') as any).select('id, category:categories(name)').in('id', productIds)
      : { data: [] }
    const catMap: Record<string, string> = {}
    ;(prods || []).forEach((p: any) => {
      const catName = Array.isArray(p.category) ? p.category[0]?.name : p.category?.name
      if (catName) catMap[p.id] = catName
    })

    return (data || []).map((s: any) => ({
      quantity: s.quantity,
      sale_price: s.sale_price,
      sale_date: s.sale_date,
      payment_method: s.payment_method,
      product_name: Array.isArray(s.product) ? s.product[0]?.name : s.product?.name,
      store_name: Array.isArray(s.store) ? s.store[0]?.name : s.store?.name,
      category_name: catMap[s.product_id] || '—',
      seller_name: Array.isArray(s.seller) ? s.seller[0]?.display_name : s.seller?.display_name,
    }))
  }

  try {
    const buffer = await buildExportWorkbook({ type, from, to, store_id: store_id || null }, fetchSales)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${type}-report-${from}-${to}.xlsx"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}
