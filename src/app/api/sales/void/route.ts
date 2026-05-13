import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role, display_name').eq('id', user.id).single()

  const { sale_id } = await request.json()
  if (!sale_id) return NextResponse.json({ error: 'Missing sale_id' }, { status: 400 })

  // Get sale with product and store info
  const { data: sale } = await (supabase.from('sales') as any)
    .select('id, product_id, store_id, sold_by, quantity, sale_price, sale_date, voided')
    .eq('id', sale_id)
    .single()

  if (!sale) return NextResponse.json({ error: 'Продажбата не е намерена' }, { status: 404 })
  if (sale.voided) return NextResponse.json({ error: 'Продажбата вече е сторнирана' }, { status: 400 })

  // Seller can only void their own sales
  if (profile?.role !== 'admin' && sale.sold_by !== user.id) {
    return NextResponse.json({ error: 'Можете да сторнирате само ваши продажби' }, { status: 403 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Mark sale as voided
  await (admin.from('sales') as any)
    .update({ voided: true, voided_at: now, voided_by: user.id })
    .eq('id', sale_id)

  // Return stock: create a new batch with the sold quantity at 0 cost
  const { data: batch } = await (admin.from('stock_batches') as any)
    .insert({
      product_id: sale.product_id,
      store_id: sale.store_id,
      quantity_remaining: sale.quantity,
      unit_cost: 0,
    })
    .select('id')
    .single()

  if (batch) {
    // Record void movement
    await (admin.from('stock_movements') as any).insert({
      product_id: sale.product_id,
      store_id: sale.store_id,
      batch_id: batch.id,
      type: 'void',
      quantity: sale.quantity,
      unit_cost: 0,
      unit_price: sale.sale_price,
      sale_id: sale.id,
      notes: 'Сторнирана продажба — връщане на склад',
      created_by: user.id,
    })
  }

  // Update product quantity_on_hand
  const { data: prod } = await (admin.from('products') as any)
    .select('quantity_on_hand').eq('id', sale.product_id).single()
  if (prod) {
    await (admin.from('products') as any)
      .update({ quantity_on_hand: prod.quantity_on_hand + sale.quantity })
      .eq('id', sale.product_id)
  }

  await logAction({
    action: 'sale_void',
    userId: user.id,
    userName: profile?.display_name || user.email,
    entityType: 'sale',
    entityId: sale_id,
    details: `Сторнирана продажба: ${sale.quantity} бр. от ${sale.product_id}`,
  }, admin)

  return NextResponse.json({ success: true, voided: true })
}
