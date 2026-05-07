import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { count } = await (supabase.from('stock_requests') as any)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  return NextResponse.json({ count: count || 0 })
}
