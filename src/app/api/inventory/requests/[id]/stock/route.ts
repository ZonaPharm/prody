import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { id } = await params

  // Get the request details to know the product_id
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('product_id, store_id')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json([])

  // Get stock per store for this product
  const { data: batches } = await (supabase.from('stock_batches') as any)
    .select('store_id, quantity_remaining, store:stores(name)')
    .eq('product_id', req.product_id)
    .gt('quantity_remaining', 0)

  // Aggregate and exclude the requesting store
  const stockMap: Record<string, { store_id: string; store_name: string; qty: number }> = {}
  ;(batches || []).forEach((b: any) => {
    if (b.store_id === req.store_id) return // skip target store
    const name = b.store?.name || (Array.isArray(b.store) ? b.store[0]?.name : '—')
    if (!stockMap[b.store_id]) {
      stockMap[b.store_id] = { store_id: b.store_id, store_name: name, qty: 0 }
    }
    stockMap[b.store_id].qty += b.quantity_remaining
  })

  return NextResponse.json(Object.values(stockMap).sort((a, b) => b.qty - a.qty))
}
