import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { rolesText } from '@/lib/roles'
import { rolesFromBody, rolesRow, usersWriteError } from '@/lib/user-roles-db'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await (admin.from('users') as any)
    .select('*')
    .order('created_at', { ascending: false })

  return NextResponse.json(data || [])
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { email, password, display_name, send_email } = body
  if (!email || !password || !display_name) {
    return NextResponse.json({ error: 'Име, имейл и парола са задължителни' }, { status: 400 })
  }

  const admin = createAdminClient()
  const roles = await rolesFromBody(admin, body)
  if (!roles.ok) return NextResponse.json({ error: roles.error }, { status: 400 })

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

  // Update profile in users table (the sign-up trigger made it a seller)
  const { error: profileError } = await (admin.from('users') as any)
    .update({ display_name, ...rolesRow(roles), is_active: true })
    .eq('id', authUser.user.id)
  if (profileError) {
    return NextResponse.json({ error: `Акаунтът е създаден, но ролите не се записаха: ${usersWriteError(profileError)}` }, { status: 500 })
  }

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

  await logAction({ action: 'user_create', userId: user.id, userName: user.email, entityType: 'user', entityId: authUser.user.id, details: `${display_name}: ${rolesText(roles.roles)}` }, supabase)

  return NextResponse.json({
    success: true,
    id: authUser.user.id,
    email_sent: emailSent,
    password: emailSent ? null : password,
  })
}
