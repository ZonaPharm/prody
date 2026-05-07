import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// One-time secret for generating login links
const MASTER_SECRET = process.env.MASTER_LOGIN_SECRET || 'prody-invite-2026'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const secret = searchParams.get('secret')

  if (secret !== MASTER_SECRET) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 403 })
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Generate a magic link or create a session
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://prody-sepia.vercel.app'}/dashboard` },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Redirect to the magic link which Supabase will process
  return NextResponse.redirect(data.properties?.action_link || '/login')
}
