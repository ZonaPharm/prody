import { NextResponse } from 'next/server'
import { deliveriesGate } from '@/lib/deliveries/api'
import { PRODUCT_COLUMNS, loadSuggestions, searchPattern, toDeliveryProducts } from '@/lib/deliveries/products'

/**
 * Product search for a delivery line: by name or SKU, active and inactive
 * (a delivery can bring back a product that was switched off), with the
 * supplier and cost to fill in.
 */
export async function GET(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const q = new URL(request.url).searchParams.get('q') ?? ''
  const pattern = searchPattern(q)
  if (!pattern) return NextResponse.json([])

  const { data, error } = await (gate.supabase.from('products') as any)
    .select(PRODUCT_COLUMNS)
    .or(`name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern}`)
    .order('status', { ascending: true })
    .order('name')
    .limit(15)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const products = data ?? []
  const { lastLines, suppliers } = await loadSuggestions(gate.supabase, products.map((p: { id: string }) => p.id))
  return NextResponse.json(toDeliveryProducts(products, lastLines, suppliers))
}
