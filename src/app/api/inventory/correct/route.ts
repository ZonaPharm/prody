import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

const VALID_REASONS = ['wrong_entry', 'damaged', 'expired', 'inventory_count', 'other']

const REASON_LABELS: Record<string, string> = {
  wrong_entry: 'Грешно въвеждане',
  damaged: 'Повреден продукт',
  expired: 'Изтекъл срок',
  inventory_count: 'Установено при инвентаризация',
  other: 'Друго',
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { product_id, store_id, actual_quantity, reason, notes } = await request.json()

  if (!product_id || !store_id || actual_quantity == null) {
    return NextResponse.json({ error: 'Липсват задължителни полета' }, { status: 400 })
  }
  if (typeof actual_quantity !== 'number' || actual_quantity < 0 || !Number.isInteger(actual_quantity)) {
    return NextResponse.json({ error: 'Невалидна бройка' }, { status: 400 })
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: 'Невалидна причина' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()

    const { data: product } = await (admin.from('products') as any)
      .select('name, quantity_on_hand')
      .eq('id', product_id)
      .single()
    if (!product) return NextResponse.json({ error: 'Продуктът не съществува' }, { status: 404 })

    const { data: store } = await (admin.from('stores') as any)
      .select('name')
      .eq('id', store_id)
      .single()
    if (!store) return NextResponse.json({ error: 'Магазинът не съществува' }, { status: 404 })

    // Sum current stock from batches
    const { data: batches } = await (admin.from('stock_batches') as any)
      .select('id, quantity_remaining, unit_cost')
      .eq('product_id', product_id)
      .eq('store_id', store_id)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: true })

    const systemTotal = (batches || []).reduce((sum: number, b: any) => sum + b.quantity_remaining, 0)
    const diff = actual_quantity - systemTotal

    if (diff === 0) {
      return NextResponse.json({ error: 'Няма разлика в наличностите' }, { status: 400 })
    }

    let movementId: string | null = null

    if (diff < 0) {
      // Decrease: FIFO deduct from oldest batches
      let remaining = Math.abs(diff)
      for (const batch of (batches || [])) {
        if (remaining <= 0) break
        const take = Math.min(remaining, batch.quantity_remaining)
        await (admin.from('stock_batches') as any)
          .update({ quantity_remaining: batch.quantity_remaining - take })
          .eq('id', batch.id)
        remaining -= take
      }

      const { data: movement } = await (admin.from('stock_movements') as any)
        .insert({
          product_id,
          store_id,
          type: 'correction',
          quantity: diff,
          unit_cost: batches?.[0]?.unit_cost ?? 0,
          notes: notes || null,
          created_by: user.id,
        })
        .select('id')
        .single()
      movementId = movement?.id
    } else {
      // Increase: add to newest batch or create one
      const newest = batches?.length > 0 ? batches[batches.length - 1] : null
      if (newest) {
        await (admin.from('stock_batches') as any)
          .update({ quantity_remaining: newest.quantity_remaining + diff })
          .eq('id', newest.id)
      } else {
        await (admin.from('stock_batches') as any)
          .insert({
            product_id,
            store_id,
            quantity_remaining: diff,
            unit_cost: 0,
          })
      }

      const { data: movement } = await (admin.from('stock_movements') as any)
        .insert({
          product_id,
          store_id,
          type: 'correction',
          quantity: diff,
          unit_cost: 0,
          notes: notes || null,
          created_by: user.id,
        })
        .select('id')
        .single()
      movementId = movement?.id
    }

    // Record in stock_corrections
    const { data: correction } = await (admin.from('stock_corrections') as any)
      .insert({
        product_id,
        store_id,
        movement_id: movementId,
        old_quantity: systemTotal,
        new_quantity: actual_quantity,
        difference: diff,
        reason,
        notes: notes || null,
        created_by: user.id,
      })
      .select('id, old_quantity, new_quantity, difference, reason, notes, created_at')
      .single()

    // Update product quantity_on_hand
    await (admin.from('products') as any)
      .update({ quantity_on_hand: product.quantity_on_hand + diff })
      .eq('id', product_id)

    // Audit log
    await logAction({
      action: 'stock_correction',
      userId: user.id,
      entityType: 'stock_correction',
      entityId: correction?.id,
      details: `${product.name} @ ${store.name}: ${systemTotal} → ${actual_quantity} (${diff > 0 ? '+' : ''}${diff}) — ${reason}`,
    }, supabase)

    return NextResponse.json({
      correction: {
        ...correction,
        product_name: product.name,
        store_name: store.name,
        reason_label: REASON_LABELS[reason] || reason,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Грешка при корекция' }, { status: 500 })
  }
}
