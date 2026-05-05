import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  return NextResponse.json({
    hasUser: !!data?.user,
    userId: data?.user?.id,
    email: data?.user?.email,
    error: error?.message,
  })
}
