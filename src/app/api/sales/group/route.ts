import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { executeSaleFIFO, getFIFOBatches } from '@/lib/inventory'
import { logAction } from '@/lib/audit'
import { sofiaToday } from '@/lib/date-utils'

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

  // Verify all products exist and have stock IN THIS SPECIFIC STORE
  // Uses admin client to bypass RLS and get real batch-level inventory
  const admin = createAdminClient()
  for (const item of items) {
    const { data: prod } = await (admin.from('products') as any)
      .select('name')
      .eq('id', item.product_id)
      .single()
    if (!prod) {
      return NextResponse.json({ error: 'Продуктът не съществува' }, { status: 400 })
    }
    // Check actual FIFO batch stock in the seller's store
    const { total } = await getFIFOBatches(item.product_id, store_id, item.quantity)
    if (total < item.quantity) {
      return NextResponse.json({ error: `Недостатъчна наличност за "${prod.name}": ${total} бр. в този обект` }, { status: 400 })
    }
  }

  const saleGroupId = crypto.randomUUID()

  const rows = items.map(item => ({
    product_id: item.product_id,
    store_id,
    sold_by: user.id,
    quantity: item.quantity,
    sale_price: item.unit_price,
    sale_date: sofiaToday(),
    sale_group_id: saleGroupId,
    payment_method: payment_method || 'cash',
  }))

  // The ids come back so each stock movement can point at its own sale row.
  // stock_movements.sale_id is a foreign key onto sales(id): passing the group
  // id instead made every insert fail the constraint, and the catch below
  // swallowed it, so sales silently stopped writing 'sell' movements.
  const { data: insertedSales, error: insertError } = await (supabase.from('sales') as any)
    .insert(rows)
    .select('id, product_id, quantity')

  if (insertError) {
    console.error('Group sale insert error:', insertError)
    return NextResponse.json({ error: 'Грешка при записване' }, { status: 500 })
  }

  // Rows come back in insert order, so pair each item with its sale row by index.
  const saleIdByIndex: string[] = (insertedSales || []).map((r: any) => r.id)

  // Decrement stock using admin client (already created above)
  const fifoFailures: string[] = []
  for (const [index, item] of items.entries()) {
    try {
      // Deducted inside the UPDATE rather than read-modify-write in JS: two
      // sales of the same product overlapping in time would otherwise both
      // read the same starting value and one deduction would be lost.
      const { error: decErr } = await (admin as any).rpc('decrement_product_stock', {
        p_product_id: item.product_id,
        p_quantity: item.quantity,
      })
      if (decErr) throw decErr

      {

        // FIFO: create sell movements from batches
        const saleId = saleIdByIndex[index]
        try {
          if (!saleId) throw new Error('missing sale id for item ' + index)
          await executeSaleFIFO(
            item.product_id,
            store_id,
            item.quantity,
            item.unit_price,
            saleId,
            user.id,
          )
        } catch (fifoErr: any) {
          // Stock has already left the batches at this point, so the sale still
          // stands; record the gap loudly instead of dropping it on the floor.
          console.error('FIFO deduction error for product:', item.product_id, fifoErr.message)
          fifoFailures.push(item.product_id)
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

  if (fifoFailures.length > 0) {
    await logAction({
      action: 'sale_fifo_failed',
      userId: user.id,
      userName: profile?.display_name || user.email,
      entityType: 'sale',
      entityId: saleGroupId,
      details: `Липсващи FIFO движения за ${fifoFailures.length} артикула: ${fifoFailures.join(', ')}`,
    }, admin)
  }

  return NextResponse.json({ success: true, sale_group_id: saleGroupId, count: items.length })
}
