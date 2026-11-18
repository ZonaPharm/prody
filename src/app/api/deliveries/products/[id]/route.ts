import { NextResponse } from 'next/server'
import { deliveriesGate } from '@/lib/deliveries/api'
import { PRODUCT_COLUMNS, loadSuggestions, toDeliveryProducts } from '@/lib/deliveries/products'
import { selectWithLabelKind } from '@/lib/deliveries/label-kind-compat'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One product as a delivery line needs it. The delivery's "Нов продукт" opens
 * the catalogue form, which saves the product itself; the line is then made
 * from this (supplier from "Източник", cost from "Доставна цена").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Продуктът не е намерен' }, { status: 404 })

  const { data, error } = await selectWithLabelKind<any | null>(PRODUCT_COLUMNS, cols =>
    (gate.supabase.from('products') as any).select(cols).eq('id', id).maybeSingle(),
  )
  if (error) return NextResponse.json({ error: (error as { message?: string }).message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Продуктът не е намерен' }, { status: 404 })

  const { lastLines, suppliers } = await loadSuggestions(gate.supabase, [id])
  const [product] = toDeliveryProducts([data], lastLines, suppliers)
  return NextResponse.json(product)
}
