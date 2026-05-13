import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { executeSaleFIFO } from '@/lib/inventory'
import { logAction } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await (supabase.from('users') as any)
    .select('role, store_id, display_name')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 403 })
  }

  const body = await request.json()
  const { store_id, items, payment_method } = body as {
    store_id: string
    items: { product_id: string; quantity: number; unit_price: number }[]
    payment_method?: string
  }

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Поне един продукт е задължителен' }, { status: 400 })
  }

  if (!store_id) {
    return NextResponse.json({ error: 'Липсва магазин' }, { status: 400 })
  }

  // Verify store exists (RLS will enforce access control)
  const { data: store } = await (supabase.from('stores') as any)
    .select('id')
    .eq('id', store_id)
    .single()

  if (!store) {
    return NextResponse.json({ error: 'Нямате достъп до този магазин' }, { status: 403 })
  }

  // Verify all products have stock
  for (const item of items) {
    const { data: prod } = await (supabase.from('products') as any)
      .select('quantity_on_hand, name')
      .eq('id', item.product_id)
      .single()
    if (!prod) {
      return NextResponse.json({ error: 'Продуктът не съществува' }, { status: 400 })
    }
    if (prod.quantity_on_hand < item.quantity) {
      return NextResponse.json({ error: `Недостатъчна наличност за "${prod.name}": ${prod.quantity_on_hand} бр.` }, { status: 400 })
    }
  }

  const saleGroupId = crypto.randomUUID()

  const rows = items.map(item => ({
    product_id: item.product_id,
    store_id,
    sold_by: user.id,
    quantity: item.quantity,
    sale_price: item.unit_price,
    sale_date: new Date().toISOString().split('T')[0],
    sale_group_id: saleGroupId,
    payment_method: payment_method || 'cash',
  }))

  const { error: insertError } = await (supabase.from('sales') as any).insert(rows)

  if (insertError) {
    console.error('Group sale insert error:', insertError)
    return NextResponse.json({ error: 'Грешка при записване' }, { status: 500 })
  }

  // Decrement stock using admin client (bypasses RLS)
  const admin = createAdminClient()
  for (const item of items) {
    try {
      const { data: prod } = await (admin.from('products') as any)
        .select('quantity_on_hand')
        .eq('id', item.product_id)
        .single()

      if (prod) {
        await (admin.from('products') as any)
          .update({ quantity_on_hand: Math.max(0, prod.quantity_on_hand - item.quantity) })
          .eq('id', item.product_id)

        // FIFO: create sell movements from batches
        try {
          await executeSaleFIFO(
            item.product_id,
            store_id,
            item.quantity,
            item.unit_price,
            saleGroupId, // use group ID to link to this transaction
            user.id,
          )
        } catch (fifoErr: any) {
          console.error('FIFO deduction error for product:', item.product_id, fifoErr.message)
        }
      }
    } catch (e) {
      console.error('Stock decrement error for product:', item.product_id, e)
    }
  }

  await logAction({
    action: 'sale_group',
    userId: user.id,
    userName: profile?.display_name || user.email,
    entityType: 'sale',
    entityId: saleGroupId,
    details: `Продажба: ${items.length} артикула, плащане ${payment_method || 'cash'}`,
  }, admin)

  return NextResponse.json({ success: true, sale_group_id: saleGroupId, count: items.length })
}
