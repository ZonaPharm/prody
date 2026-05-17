import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const REASON_LABELS: Record<string, string> = {
  wrong_entry: 'Грешно въвеждане',
  damaged: 'Повреден продукт',
  expired: 'Изтекъл срок',
  inventory_count: 'Установено при инвентаризация',
  other: 'Друго',
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id')
  const productId = searchParams.get('product_id')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

  let query = (supabase.from('stock_corrections') as any)
    .select('id, old_quantity, new_quantity, difference, reason, notes, created_at, product:products(name), store:stores(name), user:users(display_name)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (storeId) query = query.eq('store_id', storeId)
  if (productId) query = query.eq('product_id', productId)

  const { data } = await query

  return NextResponse.json((data || []).map((c: any) => ({
    id: c.id,
    old_quantity: c.old_quantity,
    new_quantity: c.new_quantity,
    difference: c.difference,
    reason: c.reason,
    reason_label: REASON_LABELS[c.reason] || c.reason,
    notes: c.notes,
    product_name: c.product?.name || '—',
    store_name: c.store?.name || '—',
    user_name: c.user?.display_name || '—',
    created_at: c.created_at,
  })))
}
