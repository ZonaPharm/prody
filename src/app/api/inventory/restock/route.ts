import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { executeRestock } from '@/lib/inventory'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { product_id, quantity, unit_cost, distribution, notes } = await request.json()

  if (!product_id || !quantity || !unit_cost) {
    return NextResponse.json({ error: 'Липсват задължителни полета' }, { status: 400 })
  }

  try {
    const results = await executeRestock({
      productId: product_id,
      totalQty: quantity,
      unitCost: unit_cost,
      userId: user.id,
      distribution: distribution || [],
      notes,
    })
    return NextResponse.json({ success: true, batches: results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Грешка при зареждане' }, { status: 500 })
  }
}
