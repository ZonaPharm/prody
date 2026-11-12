import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { deliveriesGate, parseBody } from '@/lib/deliveries/api'
import { newProductSchema } from '@/lib/deliveries/schemas'
import { PRODUCT_COLUMNS, toDeliveryProducts } from '@/lib/deliveries/products'

/**
 * "Нов продукт" from the delivery entry: name, sale price, optional category.
 * Active at once with no stock; stock arrives only when the delivery is
 * received. The rest of the product is filled in the catalogue later.
 */
export async function POST(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const body = await parseBody(request, newProductSchema)
  if (!body.ok) return body.response
  const { name, price, category_id, supplier_id, needs_label } = body.data

  let source: string | null = null
  if (supplier_id) {
    const { data: supplier } = await (gate.supabase.from('suppliers') as any)
      .select('name').eq('id', supplier_id).maybeSingle()
    if (!supplier) return NextResponse.json({ error: 'Доставчикът не е намерен' }, { status: 400 })
    // The old free-text field still feeds the catalogue and the exports.
    source = supplier.name
  }

  const admin = createAdminClient()
  const { data, error } = await (admin.from('products') as any)
    .insert({
      name,
      price,
      category_id: category_id ?? null,
      source,
      status: 'active',
      quantity_on_hand: 0,
      min_quantity: 5,
      needs_label,
    })
    .select(PRODUCT_COLUMNS)
    .single()
  if (error) {
    console.error('delivery new product failed:', JSON.stringify(error))
    return NextResponse.json({ error: error.message || 'Продуктът не можа да се създаде' }, { status: 500 })
  }

  await logAction({
    action: 'create_product',
    userId: gate.user.id,
    userName: gate.user.display_name,
    entityType: 'product',
    entityId: data.id,
    details: `${name} (от доставка)`,
  }, gate.supabase as any)

  const [product] = toDeliveryProducts([data], [], [])
  product.suggested.supplier_id = supplier_id ?? null
  product.suggested.unit_cost = null
  return NextResponse.json(product)
}
