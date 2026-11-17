import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'
import { rolesText } from '@/lib/roles'
import { rolesFromBody, rolesRow, usersWriteError } from '@/lib/user-roles-db'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()
  const body = await request.json()
  const { display_name, email, password, send_email } = body
  const roles = rolesFromBody(body)
  if (!roles.ok) return NextResponse.json({ error: roles.error }, { status: 400 })
  if (id === user.id && !roles.roles.includes('admin')) {
    return NextResponse.json({ error: 'Не можете да махнете своята роля Администратор' }, { status: 400 })
  }

  // Update auth email/password if changed
  if (email || password) {
    const update: any = {}
    if (email) update.email = email
    if (password) update.password = password
    await admin.auth.admin.updateUserById(id, update)
  }

  // Update profile
  const { error: profileError } = await (admin.from('users') as any)
    .update({ display_name, ...rolesRow(roles) })
    .eq('id', id)
  if (profileError) return NextResponse.json({ error: usersWriteError(profileError) }, { status: 500 })
  await logAction({
    action: 'user_update', userId: user.id, userName: user.email, entityType: 'user', entityId: id,
    details: `${display_name}: ${rolesText(roles.roles)}`,
  }, supabase as any)

  // Send email if password changed and checkbox checked
  let emailSent = false
  if (send_email && password) {
    try {
      const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()
      if (settings?.smtp_host) {
        const { sendWelcomeEmail } = await import('@/lib/email') as any
        await sendWelcomeEmail(settings, { email: email || '', password, display_name })
        emailSent = true
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({ success: true, email_sent: emailSent, password: emailSent ? null : password })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (id === user.id) {
    return NextResponse.json({ error: 'Не можете да деактивирате себе си' }, { status: 400 })
  }
  const admin = createAdminClient()

  // Setting is_active alone left the account able to sign in and sell: nothing
  // read the flag. Ban the account in Supabase Auth as well, so no new session
  // can be started and the current one stops at its next refresh.
  const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
  if (banError) {
    return NextResponse.json({ error: banError.message }, { status: 500 })
  }

  const { error } = await (admin.from('users') as any).update({ is_active: false }).eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
