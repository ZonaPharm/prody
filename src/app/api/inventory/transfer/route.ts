import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFIFOBatches, calculateFIFODeduction } from '@/lib/inventory'
import { logAction } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { product_id, from_store_id, to_store_id, quantity } = await request.json()

  if (!product_id || !from_store_id || !to_store_id || !quantity) {
    return NextResponse.json({ error: 'Липсват задължителни полета' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { batches, total } = await getFIFOBatches(product_id, from_store_id, quantity)

    if (total < quantity) {
      return NextResponse.json({ error: `Недостатъчна наличност: ${total} бр.` }, { status: 400 })
    }

    const { deductedFrom } = calculateFIFODeduction(batches, quantity)

    for (const d of deductedFrom) {
      // Deduct from source batch
      await (admin.from('stock_batches') as any)
        .select('quantity_remaining').eq('id', d.batchId).single()
        .then(async ({ data: b }: any) => {
          if (b) {
            await (admin.from('stock_batches') as any)
              .update({ quantity_remaining: b.quantity_remaining - d.qty })
              .eq('id', d.batchId)
          }
        })

      // Create transfer_out movement
      await (admin.from('stock_movements') as any).insert({
        product_id, store_id: from_store_id, batch_id: d.batchId,
        type: 'transfer_out', quantity: -d.qty, unit_cost: d.unitCost,
        source_store_id: to_store_id, created_by: user.id,
      })

      // Create new batch in target store with same cost
      const { data: newBatch } = await (admin.from('stock_batches') as any)
        .insert({
          product_id, store_id: to_store_id,
          quantity_remaining: d.qty, unit_cost: d.unitCost,
        })
        .select('id').single()

      if (newBatch) {
        await (admin.from('stock_movements') as any).insert({
          product_id, store_id: to_store_id, batch_id: newBatch.id,
          type: 'transfer_in', quantity: d.qty, unit_cost: d.unitCost,
          source_store_id: from_store_id, created_by: user.id,
        })
      }
    }

    await logAction({ action: 'transfer', userId: user.id, entityType: 'stock_movement', details: `${from_store_id} → ${to_store_id}, ${quantity} бр.` }, supabase)
    return NextResponse.json({ success: true, transferred: deductedFrom.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Грешка при трансфер' }, { status: 500 })
  }
}
