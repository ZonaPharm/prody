import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  const { display_name, role, store_id, email, password, send_email } = await request.json()

  // Update auth email/password if changed
  if (email || password) {
    const update: any = {}
    if (email) update.email = email
    if (password) update.password = password
    await admin.auth.admin.updateUserById(id, update)
  }

  // Update profile
  await (admin.from('users') as any)
    .update({
      display_name,
      role: role || 'seller',
      store_id: role === 'seller' ? (store_id || null) : null,
    })
    .eq('id', id)

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
  const admin = createAdminClient()
  await (admin.from('users') as any).update({ is_active: false }).eq('id', id)

  return NextResponse.json({ success: true })
}
