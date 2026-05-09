import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await (admin.from('users') as any)
    .select('id, display_name, email, role, store_id, is_active, last_sign_in_at, created_at')
    .order('created_at', { ascending: false })

  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, password, display_name, role, store_id, send_email } = await request.json()
  if (!email || !password || !display_name) {
    return NextResponse.json({ error: 'Име, имейл и парола са задължителни' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Create auth user with email_confirm: true so they can log in immediately
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name },
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  if (!authUser.user) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }

  // Update profile in users table
  await (admin.from('users') as any)
    .update({ display_name, role: role || 'seller', store_id: role === 'seller' ? (store_id || null) : null, is_active: true })
    .eq('id', authUser.user.id)

  // Send welcome email if SMTP is configured and checkbox was checked
  let emailSent = false
  if (send_email) {
    try {
      const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()
      if (settings?.smtp_host && settings?.smtp_user) {
        const { sendWelcomeEmail } = await import('@/lib/email') as any
        await sendWelcomeEmail(settings, { email, password, display_name })
        emailSent = true
      }
    } catch { /* SMTP not configured or failed */ }
  }

  await logAction({ action: 'user_create', userId: user.id, userName: user.email, entityType: 'user', details: display_name }, supabase)

  return NextResponse.json({
    success: true,
    id: authUser.user.id,
    email_sent: emailSent,
    password: emailSent ? null : password,
  })
}
