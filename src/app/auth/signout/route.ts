import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const LOGIN_URL = new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').toString()

export async function GET() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(LOGIN_URL)
}

export async function POST() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(LOGIN_URL, { status: 303 })
}
