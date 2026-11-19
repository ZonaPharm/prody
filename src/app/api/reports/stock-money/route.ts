import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sofiaDaysAgo, sofiaToday } from '@/lib/date-utils'
import { sofiaDayStartIso, sofiaDayEndIso } from '@/lib/date-ranges'
import { fetchAll } from '@/lib/fetch-all'
import {
  stockValue, deadStock, writeOffs,
  type BatchRow, type CorrectionRow, type ProductRow, type RecentSale, type StoreRow,
} from '@/lib/reports/stock-money'

/** How many rows of each list go to the page; the totals always cover all. */
const LIST_LIMIT = 200

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * „Стоката в пари“: stock value per place, dead stock and write-offs.
 * Purchase prices are for admins only, like the rest of Отчети.
 */
export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const days = searchParams.get('days') === '90' ? 90 : 60
  const fromParam = searchParams.get('from') || ''
  const toParam = searchParams.get('to') || ''
  const to = YMD.test(toParam) ? toParam : sofiaToday()
  const from = YMD.test(fromParam) ? fromParam : sofiaDaysAgo(30)

  const cutoffDate = sofiaDaysAgo(days)
  const cutoffIso = sofiaDayStartIso(cutoffDate)

  try {
    const [storesRes, products, batches, recentSales, corrections] = await Promise.all([
      (supabase.from('stores') as any).select('id, name, is_warehouse').eq('is_active', true).order('name'),
      fetchAll<ProductRow>(() => (supabase.from('products') as any)
        .select('id, name, price, cost_price')
        .order('id')),
      fetchAll<BatchRow>(() => (supabase.from('stock_batches') as any)
        .select('product_id, store_id, quantity_remaining, unit_cost, created_at')
        .gt('quantity_remaining', 0)
        .order('id')),
      fetchAll<RecentSale>(() => (supabase.from('sales') as any)
        .select('product_id, store_id')
        .gte('sale_date', cutoffDate)
        .eq('voided', false)
        .order('id')),
      fetchAll<any>(() => (supabase.from('stock_corrections') as any)
        .select('id, product_id, store_id, difference, reason, created_at, notes, movement:stock_movements(unit_cost)')
        .gte('created_at', sofiaDayStartIso(from))
        .lte('created_at', sofiaDayEndIso(to))
        .order('id')),
    ])
    if (storesRes.error) throw storesRes.error
    const stores: StoreRow[] = (storesRes.data || []).map((s: any) => ({ id: s.id, name: s.name, is_warehouse: !!s.is_warehouse }))

    const correctionRows: CorrectionRow[] = corrections.map((c: any) => {
      const movement = Array.isArray(c.movement) ? c.movement[0] : c.movement
      return {
        id: c.id, product_id: c.product_id, store_id: c.store_id, difference: c.difference,
        reason: c.reason, created_at: c.created_at, notes: c.notes,
        movement_unit_cost: movement?.unit_cost ?? null,
      }
    })

    const value = stockValue(batches, products, stores)
    const dead = deadStock(batches, products, stores, recentSales, cutoffIso)
    const off = writeOffs(correctionRows, products, stores)

    return NextResponse.json({
      value,
      dead: { ...dead, rows: dead.rows.slice(0, LIST_LIMIT), days, cutoffDate },
      writeOffs: { ...off, rows: off.rows.slice(0, LIST_LIMIT), from, to },
    })
  } catch (e: any) {
    console.error('stock-money report failed:', e)
    return NextResponse.json({ error: 'Грешка при зареждане на стоката в пари' }, { status: 500 })
  }
}
