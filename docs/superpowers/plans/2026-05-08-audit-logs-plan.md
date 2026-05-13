# Audit Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add audit logging for actions and auth events, viewable in Settings via two sub-tabs.

**Architecture:** Single `audit_logs` table with `type` field. Lib provides `logAction()` and `logAuth()` helpers. API endpoint with filters serves logs to UI. Key existing API routes get log calls added.

**Tech Stack:** Supabase, Next.js 16, shadcn/ui, no new packages

---

### Task 1: Migration + Audit Lib

**Files:**
- Create: `supabase/migrations/00014_audit_logs.sql`
- Create: `src/lib/audit.ts`

- [ ] **Step 1: Apply migration**

Via MCP apply_migration:
```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('action', 'auth')),
  action text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  user_name text,
  entity_type text,
  entity_id uuid,
  details text,
  metadata jsonb,
  status text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_type_created ON audit_logs(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins full access audit_logs" ON audit_logs;
CREATE POLICY "Admins full access audit_logs" ON audit_logs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Create audit lib**

Create `src/lib/audit.ts`:
```typescript
import { createAdminClient } from '@/lib/supabase/admin'

interface LogEntry {
  type: 'action' | 'auth'
  action: string
  userId?: string
  userName?: string
  entityType?: string
  entityId?: string
  details?: string
  metadata?: any
  status?: string
}

export async function logAction(entry: Omit<LogEntry, 'type'>) {
  try {
    const admin = createAdminClient()
    await (admin.from('audit_logs') as any).insert({
      type: 'action',
      action: entry.action,
      user_id: entry.userId || null,
      user_name: entry.userName || null,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId || null,
      details: entry.details || null,
      metadata: entry.metadata || null,
    })
  } catch { /* silent — audit log should never break the app */ }
}

export async function logAuth(entry: Omit<LogEntry, 'type'>) {
  try {
    const admin = createAdminClient()
    await (admin.from('audit_logs') as any).insert({
      type: 'auth',
      action: entry.action,
      user_id: entry.userId || null,
      user_name: entry.userName || null,
      details: entry.details || null,
      status: entry.status || null,
      metadata: entry.metadata || null,
    })
  } catch { /* silent */ }
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00014_audit_logs.sql src/lib/audit.ts
git commit -m "feat: audit_logs migration and audit lib"
```

---

### Task 2: Audit Logs API + Integrate into Key Routes

**Files:**
- Create: `src/app/api/audit-logs/route.ts`
- Modify: Various API routes to add log calls

- [ ] **Step 1: Create audit-logs API**

Create `src/app/api/audit-logs/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const action = searchParams.get('action')
  const userId = searchParams.get('user_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const limit = parseInt(searchParams.get('limit') || '100')

  let query = (supabase.from('audit_logs') as any)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (type) query = query.eq('type', type)
  if (action) query = query.eq('action', action)
  if (userId) query = query.eq('user_id', userId)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data } = await query
  return NextResponse.json(data || [])
}
```

- [ ] **Step 2: Add log calls to auth API**

Modify `src/app/api/auth/set-cookies/route.ts` — add after successful login:
```typescript
import { logAuth } from '@/lib/audit'
// At successful session creation:
await logAuth({ action: 'login', status: 'success', userId: user.id, userName: user.email, details: 'Вход с парола' })
```

Modify the login flow — add to magic link send:
```typescript
await logAuth({ action: 'magiclink', status: 'sent', details: email })
```

- [ ] **Step 3: Add log calls to key action routes**

Add `import { logAction } from '@/lib/audit'` and calls in:
- `src/app/api/products/update-min-qty/route.ts` — action: 'update_product'
- `src/app/api/inventory/restock/route.ts` — action: 'restock'
- `src/app/api/inventory/transfer/route.ts` — action: 'transfer'
- `src/app/api/inventory/request/route.ts` — action: 'request_create'
- `src/app/api/inventory/requests/[id]/fulfill/route.ts` — action: 'request_fulfill'
- `src/app/api/inventory/requests/[id]/confirm/route.ts` — action: 'request_confirm'
- `src/app/api/users/route.ts` (POST) — action: 'user_create'
- `src/app/api/users/[id]/route.ts` (PUT/DELETE) — action: 'user_update' / 'user_deactivate'
- `src/app/api/email-settings/route.ts` (POST) — action: 'settings_update'
- `src/app/api/sales/group/route.ts` — action: 'sale'

Format for each: `logAction({ action: 'x', userId: user.id, userName: user.email, entityType: 'y', entityId: id, details: '...' }).catch(() => {})`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/
git commit -m "feat: audit log API and integration into routes"
```

---

### Task 3: Audit Logs UI

**Files:**
- Create: `src/app/(admin)/settings/audit-logs.tsx`
- Modify: `src/app/(admin)/settings/page.tsx` — add tab

- [ ] **Step 1: Create UI component**

Create `src/app/(admin)/settings/audit-logs.tsx`:
```typescript
'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const ACTION_LABELS: Record<string, string> = {
  create_product: '📦 Създаден продукт', update_product: '✏️ Редактиран продукт', delete_product: '🗑️ Изтрит продукт',
  restock: '📥 Зареждане', transfer: '🔄 Трансфер', sale: '🛒 Продажба',
  request_create: '📋 Заявка', request_fulfill: '✅ Изпълнена заявка', request_confirm: '✔️ Потвърдена заявка',
  user_create: '👤 Създаден потребител', user_update: '✏️ Редактиран потребител', user_deactivate: '🚫 Деактивиран',
  settings_update: '⚙️ Настройки', error: '❌ Грешка',
  login: '🔑 Вход', magiclink: '📧 Magic link', logout: '🚪 Изход',
}

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [type, setType] = useState('action')
  const [action, setAction] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const params = new URLSearchParams({ type, limit: '200' })
    if (action) params.set('action', action)
    if (userFilter) params.set('user_id', userFilter)
    if (from) params.set('from', from + 'T00:00:00')
    if (to) params.set('to', to + 'T23:59:59')
    const res = await fetch(`/api/audit-logs?${params}`)
    setLogs(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [type, action, from, to])

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Логове</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={type} onValueChange={setType}>
          <TabsList className="mb-4">
            <TabsTrigger value="action">📋 Действия</TabsTrigger>
            <TabsTrigger value="auth">🔑 Вход/Изход</TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap gap-2 mb-4">
            {type === 'action' && (
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="Всички действия" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Всички действия</SelectItem>
                  {Object.entries(ACTION_LABELS).filter(([k]) => !['login','magiclink','logout'].includes(k)).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {type === 'auth' && (
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Всички" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Всички</SelectItem>
                  <SelectItem value="login">Вход</SelectItem>
                  <SelectItem value="magiclink">Magic link</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[140px] h-8 text-xs" />
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[140px] h-8 text-xs" />
          </div>

          <TabsContent value="action" className="mt-0">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-xs">Час</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Потребител</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Действие</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Детайли</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Няма записи</td></tr>
                  ) : (
                    logs.map(l => (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(l.created_at).toLocaleString('bg-BG')}
                        </td>
                        <td className="px-4 py-2 text-xs">{l.user_name || '—'}</td>
                        <td className="px-4 py-2 text-xs">{ACTION_LABELS[l.action] || l.action}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{l.details || l.entity_type || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="auth" className="mt-0">
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-xs">Час</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Потребител</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Действие</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Статус</th>
                    <th className="text-left px-4 py-2 font-medium text-xs">Детайли</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Няма записи</td></tr>
                  ) : (
                    logs.map(l => (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(l.created_at).toLocaleString('bg-BG')}
                        </td>
                        <td className="px-4 py-2 text-xs">{l.user_name || l.details || '—'}</td>
                        <td className="px-4 py-2 text-xs">{ACTION_LABELS[l.action] || l.action}</td>
                        <td className="px-4 py-2 text-xs">
                          <Badge variant="secondary" className={`text-[10px] ${l.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {l.status === 'success' ? '✅ Успех' : l.status === 'failed' ? '❌ Грешка' : l.status || '—'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{l.details || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Add tab to settings page**

Add import: `import { AuditLogs } from './audit-logs'`
Add trigger: `<TabsTrigger value="logs">Логове</TabsTrigger>`
Add content: `<TabsContent value="logs"><AuditLogs /></TabsContent>`

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/settings/
git commit -m "feat: audit logs UI — actions and auth sub-tabs"
```

---

### Task 4: Final Verification & Push

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Push**

```bash
git push origin main && git push github main
```
