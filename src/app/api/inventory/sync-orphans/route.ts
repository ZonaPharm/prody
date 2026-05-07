import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Find warehouse
  const { data: warehouse } = await (admin.from('stores') as any)
    .select('id').eq('is_warehouse', true).eq('is_active', true).limit(1).single()

  let storeId = warehouse?.id
  if (!storeId) {
    const { data: firstStore } = await (admin.from('stores') as any)
      .select('id').eq('is_active', true).limit(1).single()
    storeId = firstStore?.id
  }
  if (!storeId) {
    return NextResponse.json({ error: 'No active stores found' }, { status: 400 })
  }

  // Get all batches grouped by product
  const { data: allBatches } = await (admin.from('stock_batches') as any)
    .select('product_id, quantity_remaining')

  const batchedQty: Record<string, number> = {}
  ;(allBatches || []).forEach((b: any) => {
    batchedQty[b.product_id] = (batchedQty[b.product_id] || 0) + b.quantity_remaining
  })

  // Find products with quantity_on_hand > 0
  const { data: products } = await (admin.from('products') as any)
    .select('id, name, quantity_on_hand')
    .gt('quantity_on_hand', 0)
    .eq('status', 'active')

  const orphans = (products || []).filter((p: any) => !batchedQty[p.id] || batchedQty[p.id] === 0)

  const results: { id: string; name: string; qty: number }[] = []

  for (const p of orphans) {
    const { data: batch } = await (admin.from('stock_batches') as any)
      .insert({
        product_id: p.id,
        store_id: storeId,
        quantity_remaining: p.quantity_on_hand,
        unit_cost: 0,
      })
      .select('id').single()

    if (batch) {
      await (admin.from('stock_movements') as any).insert({
        product_id: p.id,
        store_id: storeId,
        batch_id: batch.id,
        type: 'restock',
        quantity: p.quantity_on_hand,
        unit_cost: 0,
        notes: 'Синхронизиране на наличности',
        created_by: user.id,
      })
      results.push({ id: p.id, name: p.name, qty: p.quantity_on_hand })
    }
  }

  return NextResponse.json({ success: true, synced: results.length, products: results })
}
