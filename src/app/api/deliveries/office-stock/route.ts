import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deliveriesGate } from '@/lib/deliveries/api'
import { searchPattern } from '@/lib/deliveries/products'
import { officeRows } from '@/lib/deliveries/office'

/**
 * Product search for "Добави от Офис": by name, SKU or barcode, with what Офис holds
 * and how much of it is free (office_free_stock: not bound to an open delivery, not
 * already waiting in a shipment).
 */
export async function GET(request: Request) {
  const gate = await deliveriesGate()
  if (!gate.ok) return gate.response
  const supabase = gate.supabase as any

  const pattern = searchPattern(new URL(request.url).searchParams.get('q') ?? '')
  if (!pattern) return NextResponse.json([])

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, sku, price, images:product_images(url, is_primary, sort_order)')
    .or(`name.ilike.${pattern},sku.ilike.${pattern},barcode.ilike.${pattern}`)
    .order('name')
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = (products ?? []).map((p: { id: string }) => p.id)
  if (ids.length === 0) return NextResponse.json([])

  // service_role only, like the other delivery functions; the gate above let an admin in.
  const { data: free, error: e2 } = await (createAdminClient() as any).rpc('office_free_stock', { p_product_ids: ids })
  if (e2) {
    // PGRST202 / 42883: the function is not in this database yet (migration not run).
    const missing = e2.code === 'PGRST202' || e2.code === '42883'
    if (!missing) console.error('office_free_stock failed:', JSON.stringify(e2))
    return NextResponse.json(
      { error: missing ? '„Добави от Офис“ още не е включено в базата (миграцията 20261112_deliveries_office_stock.sql).' : 'Наличността в Офис не можа да се зареди' },
      { status: missing ? 503 : 500 },
    )
  }
  return NextResponse.json(officeRows(products ?? [], free ?? []))
}
