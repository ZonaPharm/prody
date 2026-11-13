import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rpcErrorResponse } from '@/lib/rpc-error'
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

    // One transaction in the database: FIFO from the source store's batches,
    // a transfer_out per batch, a new batch at the same cost in the target
    // store with its transfer_in. The old read-compute-write in JS could lose
    // a deduction to a sale of the same product at the same moment, and left
    // half a transfer behind when one of its writes failed.
    const { data: touched, error } = await (admin as any).rpc('transfer_stock', {
      p_product_id: product_id,
      p_from_store: from_store_id,
      p_to_store: to_store_id,
      p_quantity: quantity,
      p_user: user.id,
      p_notes: null,
    })

    if (error) {
      const { status, error: message } = rpcErrorResponse(error, 'Грешка при трансфер')
      if (status === 500) console.error('transfer_stock failed:', JSON.stringify(error))
      return NextResponse.json({ error: message }, { status })
    }

    await logAction({ action: 'transfer', userId: user.id, entityType: 'stock_movement', details: `${from_store_id} → ${to_store_id}, ${quantity} бр.` }, supabase)
    return NextResponse.json({ success: true, transferred: touched ?? 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Грешка при трансфер' }, { status: 500 })
  }
}
