import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('stores')
    .select('id, name, is_warehouse')
    .eq('is_active', true)
    .order('name')
  return NextResponse.json(data || [])
}
