import { NextResponse } from 'next/server'
import { deliveriesGate, isUuid } from '@/lib/deliveries/api'
import { getSupplierProducts } from '@/lib/supplier-orders/queries'

/** What we usually take from one supplier, for step 2 of a new order. */
export async function GET(request: Request) {
  const gate = await deliveriesGate({ adminOnly: true })
  if (!gate.ok) return gate.response

  const supplierId = new URL(request.url).searchParams.get('supplier_id')
  if (!isUuid(supplierId)) return NextResponse.json({ error: 'Изберете доставчик' }, { status: 400 })
  try {
    return NextResponse.json(await getSupplierProducts(gate.supabase, supplierId))
  } catch (e: any) {
    console.error('supplier products failed:', JSON.stringify(e))
    return NextResponse.json({ error: 'Продуктите на доставчика не се заредиха' }, { status: 500 })
  }
}
