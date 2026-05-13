# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user CRUD in Settings — list, create/edit, assign roles/stores, temp passwords, welcome email via SMTP.

**Architecture:** New API routes manage users via Supabase Admin API. New `users-manager.tsx` component provides table + dialog UI in Settings. Existing email lib extended with `sendWelcomeEmail()`. Email sending is optional — if SMTP not configured, admin can copy the password manually.

**Tech Stack:** Supabase Admin API, existing nodemailer SMTP, shadcn/ui, no new packages

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/app/api/users/route.ts` | Create | GET list users + POST create user |
| `src/app/api/users/[id]/route.ts` | Create | PUT update user + DELETE deactivate |
| `src/app/(admin)/settings/users-manager.tsx` | Create | Table + add/edit dialog |
| `src/lib/email.ts` | Modify | Add sendWelcomeEmail() |
| `src/app/(admin)/settings/page.tsx` | Modify | Add "Потребители" tab |

---

### Task 1: Create Users API Routes

**Files:**
- Create: `src/app/api/users/route.ts`
- Create: `src/app/api/users/[id]/route.ts`

- [ ] **Step 1: Create GET/POST users route**

Create `src/app/api/users/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

  // Create auth user
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
    .update({ display_name, role: role || 'seller', store_id: role === 'seller' ? store_id : null, is_active: true })
    .eq('id', authUser.user.id)

  // Send welcome email if SMTP is configured and checkbox was checked
  let emailSent = false
  if (send_email) {
    try {
      const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()
      if (settings?.smtp_host && settings?.smtp_user) {
        const { sendWelcomeEmail } = await import('@/lib/email')
        await sendWelcomeEmail(settings, { email, password, display_name })
        emailSent = true
      }
    } catch { /* SMTP not configured or failed */ }
  }

  return NextResponse.json({
    success: true,
    id: authUser.user.id,
    email_sent: emailSent,
    password: emailSent ? null : password, // Return password only if email wasn't sent
  })
}
```

- [ ] **Step 2: Create PUT/DELETE user route**

Create directory and file `src/app/api/users/[id]/route.ts`:

```typescript
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

  // Update auth email if changed
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

  // Send email if requested and password changed
  let emailSent = false
  if (send_email && password) {
    try {
      const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()
      if (settings?.smtp_host) {
        const { sendWelcomeEmail } = await import('@/lib/email')
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

  // Soft-deactivate
  await (admin.from('users') as any).update({ is_active: false }).eq('id', id)

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Verify and commit**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -10`

```bash
git add src/app/api/users/
git commit -m "feat: users CRUD API — list, create, update, deactivate"
```

---

### Task 2: Add sendWelcomeEmail to email lib

**Files:**
- Modify: `src/lib/email.ts` — add function

- [ ] **Step 1: Add sendWelcomeEmail function**

Append to `src/lib/email.ts`:

```typescript
export async function sendWelcomeEmail(
  settings: { smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; sender_email: string },
  user: { email: string; password: string; display_name: string }
) {
  const transport = nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_port === 465,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  })

  const loginUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://prody.vercel.app'

  await transport.sendMail({
    from: settings.sender_email,
    to: user.email,
    subject: 'Вашият Prody акаунт е готов',
    html: `<h2>Добре дошли в Prody!</h2>
<p>Здравейте, ${user.display_name},</p>
<p>Вашият акаунт е създаден. Можете да влезете със следните данни:</p>
<table>
<tr><td><strong>Имейл:</strong></td><td>${user.email}</td></tr>
<tr><td><strong>Парола:</strong></td><td>${user.password}</td></tr>
</table>
<p><a href="${loginUrl}/login">Влезте в Prody</a></p>
<p>Препоръчваме да смените паролата си след първия вход.</p>`,
  })
}
```

- [ ] **Step 2: Verify and commit**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -10`

```bash
git add src/lib/email.ts
git commit -m "feat: add sendWelcomeEmail to email lib"
```

---

### Task 3: Create Users Manager UI

**Files:**
- Create: `src/app/(admin)/settings/users-manager.tsx`

- [ ] **Step 1: Get stores list from settings page**

Read `src/app/(admin)/settings/page.tsx` and find the stores fetch. The users manager needs stores for the dropdown. Pass stores as a prop from the settings page, or fetch inside the component.

Since the settings page already fetches stores for other tabs... actually it doesn't. The stores manager handles its own fetch. Let the users manager fetch stores itself.

- [ ] **Step 2: Create the component**

Create `src/app/(admin)/settings/users-manager.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Link, Ban, Loader2, Copy, Check } from 'lucide-react'

interface UserRow {
  id: string
  display_name: string
  email: string
  role: string
  store_id: string | null
  is_active: boolean
  last_sign_in_at: string | null
  created_at: string
}

export function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [toast, setToast] = useState('')

  // Form state
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState('seller')
  const [formStoreId, setFormStoreId] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formSendEmail, setFormSendEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [returnedPassword, setReturnedPassword] = useState('')

  const loadUsers = async () => {
    const res = await fetch('/api/users')
    setUsers(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])
  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setStores(d.filter((s: any) => !s.is_warehouse))
    }).catch(() => {})
  }, [])

  const genPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let pw = ''
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)]
    setFormPassword(pw)
  }

  const openNew = () => {
    setEditing(null)
    setFormName(''); setFormEmail(''); setFormRole('seller')
    setFormStoreId(''); setFormSendEmail(true); setReturnedPassword('')
    genPassword()
    setDialogOpen(true)
  }

  const openEdit = (u: UserRow) => {
    setEditing(u)
    setFormName(u.display_name || '')
    setFormEmail(u.email || '')
    setFormRole(u.role || 'seller')
    setFormStoreId(u.store_id || '')
    setFormPassword('')
    setFormSendEmail(false)
    setReturnedPassword('')
    setDialogOpen(true)
  }

  const save = async () => {
    if (!formName || !formEmail) return
    setSaving(true)
    setReturnedPassword('')

    const body: any = { display_name: formName, email: formEmail, role: formRole, store_id: formRole === 'seller' ? formStoreId : null, send_email: formSendEmail }
    if (formPassword) body.password = formPassword

    try {
      const url = editing ? `/api/users/${editing.id}` : '/api/users'
      const method = editing ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      if (data.password) setReturnedPassword(data.password)
      else if (!editing) { setDialogOpen(false); loadUsers() }
      else { setDialogOpen(false); loadUsers() }
    } catch (e: any) { setToast(e.message || 'Грешка'); setTimeout(() => setToast(''), 3000) }
    setSaving(false)
  }

  const deactivate = async (u: UserRow) => {
    if (!confirm(`Деактивиране на ${u.display_name}?`)) return
    await fetch(`/api/users/${u.id}`, { method: 'DELETE' })
    loadUsers()
  }

  const copyPassword = () => {
    navigator.clipboard.writeText(returnedPassword)
    setToast('Паролата е копирана')
    setTimeout(() => setToast(''), 2000)
  }

  const roleLabel: Record<string, string> = { admin: 'Админ', seller: 'Продавач' }

  if (loading) return <div className="p-4 text-muted-foreground">Зареждане...</div>

  return (
    <Card>
      {toast && <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm">{toast}</div>}
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-lg">Потребители</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Добави</Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Име</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Имейл</th>
                <th className="text-center px-4 py-3 font-medium">Роля</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Магазин</th>
                <th className="text-center px-4 py-3 font-medium">Статус</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium">{u.display_name}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="secondary" className={`text-[10px] ${u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                      {roleLabel[u.role] || u.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{stores.find(s => s.id === u.store_id)?.name || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {!u.is_active ? (
                      <Badge variant="secondary" className="bg-red-100 text-red-800 text-[10px]">Деактивиран</Badge>
                    ) : u.last_sign_in_at ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px]">Активен</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-[10px]">Поканен</Badge>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => deactivate(u)}><Ban className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>{editing ? 'Редактирай потребител' : 'Нов потребител'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-1">
                <Label className="text-xs">Име</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Имейл</Label>
                <Input value={formEmail} onChange={e => setFormEmail(e.target.value)} className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Роля</Label>
                  <Select value={formRole} onValueChange={v => setFormRole(v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Админ</SelectItem>
                      <SelectItem value="seller">Продавач</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formRole === 'seller' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Магазин</Label>
                    <Select value={formStoreId} onValueChange={setFormStoreId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Избери" /></SelectTrigger>
                      <SelectContent>
                        {stores.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Парола</Label>
                  <button type="button" onClick={genPassword} className="text-xs text-blue-600 hover:underline">Генерирай</button>
                </div>
                <Input value={formPassword} onChange={e => setFormPassword(e.target.value)} className="h-9" placeholder={editing ? 'Остави празно за без промяна' : ''} />
              </div>
              {!editing && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formSendEmail} onChange={e => setFormSendEmail(e.target.checked)} />
                  <span className="text-sm">📧 Изпрати данни за вход на имейла</span>
                </label>
              )}
              {returnedPassword && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-amber-700 font-medium">Парола (копирай преди да затвориш)</p>
                    <p className="text-sm font-mono font-bold">{returnedPassword}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={copyPassword}><Copy className="mr-1 h-3 w-3" />Копирай</Button>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>Отказ</Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  {editing ? 'Запази' : 'Създай'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Verify and commit**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -10`

```bash
git add src/app/\(admin\)/settings/users-manager.tsx
git commit -m "feat: users manager UI — table, create/edit dialog, welcome email"
```

---

### Task 4: Add Users tab to Settings page

**Files:**
- Modify: `src/app/(admin)/settings/page.tsx`

- [ ] **Step 1: Add import and tab**

Add import: `import { UsersManager } from './users-manager'`

Add tab trigger inside `<TabsList>`:
```tsx
<TabsTrigger value="users">Потребители</TabsTrigger>
```

Add tab content:
```tsx
<TabsContent value="users">
  <UsersManager />
</TabsContent>
```

- [ ] **Step 2: Verify and commit**

```bash
git add src/app/\(admin\)/settings/page.tsx
git commit -m "feat: add users tab to settings page"
```

---

### Task 5: Final Verification & Push

- [ ] **Step 1: TypeScript check**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | grep -c "error" || echo "0"`

- [ ] **Step 2: Push to both remotes**

```bash
git push origin main && git push github main
```
