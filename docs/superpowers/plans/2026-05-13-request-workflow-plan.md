# Request Workflow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign stock request system with clear statuses, comments, split-panel admin UI, and seller request page.

**Architecture:** New status flow (pending→accepted→in_transit→delivered→confirmed), new `request_notes` table for comments, new API endpoints per status transition, split-panel admin UI (batch list | detail), seller page with Заяви/Моите заявки tabs. All new columns nullable — backwards compatible.

**Tech Stack:** Next.js 16, Supabase (Postgres + RLS), TypeScript, shadcn/ui + Tailwind

**Pre-flight:** 0 existing stock_requests rows — no data migration needed. 2659 rows across all other tables.

---

## File Map

### Create:
- `supabase/migrations/00004_request_workflow.sql` — migration
- `src/app/api/inventory/requests/[id]/accept/route.ts` — admin accepts
- `src/app/api/inventory/requests/[id]/ship/route.ts` — admin ships
- `src/app/api/inventory/requests/[id]/deliver/route.ts` — admin marks delivered
- `src/app/api/inventory/requests/[id]/notes/route.ts` — GET + POST comments
- `src/app/(seller)/requests/page.tsx` — seller request page
- `src/components/inventory/seller-request-form.tsx` — product search + request basket

### Modify:
- `src/app/api/inventory/requests/[id]/reject/route.ts` — admin client + event log
- `src/app/api/inventory/requests/[id]/confirm/route.ts` — event log for new statuses
- `src/app/api/inventory/requests/[id]/events/route.ts` — use real request_events table
- `src/app/api/inventory/requests/route.ts` — accept new status filter params
- `src/app/(admin)/requests/requests-client.tsx` — split panel + new statuses
- `src/app/(admin)/layout-client.tsx` — add seller requests nav item
- `src/app/(seller)/low-stock/page.tsx` — link to new requests page

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00004_request_workflow.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 00004_request_workflow
-- Adds request_notes, request_events tables + new status columns

-- 1. request_notes table
CREATE TABLE IF NOT EXISTS request_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES stock_requests(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_notes_request ON request_notes(request_id, created_at);
ALTER TABLE request_notes ENABLE ROW LEVEL SECURITY;

-- RLS: both admin and seller can read/write notes on requests they can access
DROP POLICY IF EXISTS "Users can read request notes" ON request_notes;
CREATE POLICY "Users can read request notes" ON request_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM stock_requests sr WHERE sr.id = request_notes.request_id));
DROP POLICY IF EXISTS "Users can insert request notes" ON request_notes;
CREATE POLICY "Users can insert request notes" ON request_notes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM stock_requests sr WHERE sr.id = request_notes.request_id));

-- 2. request_events table (if not exists)
CREATE TABLE IF NOT EXISTS request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES stock_requests(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  notes text,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_id, created_at);
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read request events" ON request_events;
CREATE POLICY "Users can read request events" ON request_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM stock_requests sr WHERE sr.id = request_events.request_id));
DROP POLICY IF EXISTS "Users can insert request events" ON request_events;
CREATE POLICY "Users can insert request events" ON request_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM stock_requests sr WHERE sr.id = request_events.request_id));

-- 3. New status columns on stock_requests (all nullable)
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS in_transit_at timestamptz;
ALTER TABLE stock_requests ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
```

- [ ] **Step 2: Push migration**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx supabase db push 2>&1`
(If supabase CLI not available, run via Supabase Dashboard SQL Editor)

- [ ] **Step 3: Verify tables exist**

Run REST API check:
```javascript
fetch(`${SUPABASE_URL}/rest/v1/request_notes?select=count`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
// Should return 200
fetch(`${SUPABASE_URL}/rest/v1/request_events?select=count`, { headers })
// Should return 200
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00004_request_workflow.sql
git commit -m "feat: add request_notes, request_events tables, new status columns"
```

---

### Task 2: Fix Reject Endpoint

**Files:**
- Modify: `src/app/api/inventory/requests/[id]/reject/route.ts`

- [ ] **Step 1: Change to admin client for the update, add event logging**

Replace the update section (lines 33-47):

```typescript
import { createAdminClient } from '@/lib/supabase/admin'

// ... inside POST, replace the update at line 36-38:

  const admin = createAdminClient()
  const now = new Date().toISOString()

  await (admin.from('stock_requests') as any)
    .update({ status: 'rejected', updated_at: now })
    .eq('id', id)

  // Log event
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id,
      status: 'rejected',
      user_id: user.id,
      notes: `Отказана заявка: ${productName || '—'} (${req.requested_qty} бр.)`,
      created_at: now,
    })
  } catch { /* table may not exist yet */ }

  await logAction({
    action: 'request_reject',
    userId: user.id,
    entityType: 'stock_request',
    entityId: id,
    details: `Отказана заявка: ${productName || '—'} (${req.requested_qty} бр.)`,
  }, admin) // use admin client for audit log
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit`
Expected: EXIT: 0

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/reject/route.ts
git commit -m "fix: reject endpoint uses admin client, logs to request_events"
```

---

### Task 3: Accept Endpoint (admin: pending → accepted)

**Files:**
- Create: `src/app/api/inventory/requests/[id]/accept/route.ts`

- [ ] **Step 1: Write the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('id, status')
    .eq('id', id).single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Може да приемете само чакащи заявки' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  await (admin.from('stock_requests') as any)
    .update({ status: 'accepted', accepted_at: now, updated_at: now })
    .eq('id', id)

  try {
    await (admin.from('request_events') as any).insert({
      request_id: id, status: 'accepted', user_id: user.id,
      notes: 'Заявката е приета', created_at: now,
    })
  } catch { /* table may not exist */ }

  await logAction({ action: 'request_accept', userId: user.id, entityType: 'stock_request', entityId: id }, admin)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/accept/route.ts
git commit -m "feat: accept endpoint — pending → accepted"
```

---

### Task 4: Ship Endpoint (admin: accepted → in_transit)

**Files:**
- Create: `src/app/api/inventory/requests/[id]/ship/route.ts`

- [ ] **Step 1: Write the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('id, status')
    .eq('id', id).single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'accepted') {
    return NextResponse.json({ error: 'Може да изпратите само приети заявки' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  await (admin.from('stock_requests') as any)
    .update({ status: 'in_transit', in_transit_at: now, updated_at: now })
    .eq('id', id)

  try {
    await (admin.from('request_events') as any).insert({
      request_id: id, status: 'in_transit', user_id: user.id,
      notes: 'Пратена към магазина', created_at: now,
    })
  } catch { /* table may not exist */ }

  await logAction({ action: 'request_ship', userId: user.id, entityType: 'stock_request', entityId: id }, admin)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/ship/route.ts
git commit -m "feat: ship endpoint — accepted → in_transit"
```

---

### Task 5: Deliver Endpoint (admin: in_transit → delivered)

**Files:**
- Create: `src/app/api/inventory/requests/[id]/deliver/route.ts`

- [ ] **Step 1: Write the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('id, status')
    .eq('id', id).single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'in_transit') {
    return NextResponse.json({ error: 'Може да доставите само изпратени заявки' }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  await (admin.from('stock_requests') as any)
    .update({ status: 'delivered', delivered_at: now, updated_at: now })
    .eq('id', id)

  try {
    await (admin.from('request_events') as any).insert({
      request_id: id, status: 'delivered', user_id: user.id,
      notes: 'Доставена в магазина', created_at: now,
    })
  } catch { /* table may not exist */ }

  await logAction({ action: 'request_deliver', userId: user.id, entityType: 'stock_request', entityId: id }, admin)
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/deliver/route.ts
git commit -m "feat: deliver endpoint — in_transit → delivered"
```

---

### Task 6: Notes Endpoint (GET + POST comments)

**Files:**
- Create: `src/app/api/inventory/requests/[id]/notes/route.ts`

- [ ] **Step 1: Write the endpoint**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data } = await (supabase.from('request_notes') as any)
    .select('id, body, user_id, created_at, user:users(display_name)')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json((data || []).map((n: any) => ({
    id: n.id,
    body: n.body,
    user_id: n.user_id,
    user_name: Array.isArray(n.user) ? n.user[0]?.display_name : n.user?.display_name,
    created_at: n.created_at,
  })))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { body } = await request.json()
  if (!body || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'Коментарът е задължителен' }, { status: 400 })
  }

  // Get user display name
  const { data: profile } = await (supabase.from('users') as any)
    .select('display_name').eq('id', user.id).single()

  const { data: note, error } = await (supabase.from('request_notes') as any)
    .insert({
      request_id: id,
      user_id: user.id,
      body: body.trim(),
    })
    .select('id, body, user_id, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ...note,
    user_name: profile?.display_name || user.email,
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/notes/route.ts
git commit -m "feat: request notes endpoint — GET + POST comments"
```

---

### Task 7: Update Confirm Endpoint for New Statuses

**Files:**
- Modify: `src/app/api/inventory/requests/[id]/confirm/route.ts`

- [ ] **Step 1: Accept delivered status + log event**

Change the status check at line 24:

```typescript
// Old: if (req.status !== 'fulfilled')
// New:
if (req.status !== 'fulfilled' && req.status !== 'delivered') {
  return NextResponse.json({ error: 'Заявката не е доставена все още' }, { status: 400 })
}
```

Change the admin event insert at lines 62-71:

```typescript
  // Log event — now uses real table
  try {
    await (admin.from('request_events') as any).insert({
      request_id: id,
      status,
      user_id: user.id,
      notes: confirmNote,
      meta: { received_qty: actualQty, requested_qty: req.requested_qty },
      created_at: new Date().toISOString(),
    })
  } catch { /* table doesn't exist yet */ }
```

And change the logAction client from `supabase` to `admin` at line 73:

```typescript
  await logAction({ action: 'request_confirm', userId: user.id, entityType: 'stock_request', entityId: id, details: `Статус: ${status}` }, admin)
```

- [ ] **Step 2: Verify TypeScript**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/confirm/route.ts
git commit -m "fix: confirm accepts delivered status, uses admin for event log"
```

---

### Task 8: Update Events Endpoint

**Files:**
- Modify: `src/app/api/inventory/requests/[id]/events/route.ts`

- [ ] **Step 1: Remove fallback, use real table with better mapping**

Replace the entire GET handler:

```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Try request_events first
  const { data: events } = await (supabase.from('request_events') as any)
    .select('id, status, notes, meta, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  if (events && events.length > 0) {
    return NextResponse.json(events)
  }

  // Fallback: derive from request status
  const { data: req } = await (supabase.from('stock_requests') as any)
    .select('status, notes, created_at, updated_at, requested_qty, accepted_at, in_transit_at, delivered_at')
    .eq('id', id)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const derived: any[] = [{
    status: 'pending',
    notes: 'Заявката е създадена',
    created_at: req.created_at,
  }]

  if (req.accepted_at || req.status === 'accepted' || req.status === 'in_transit' || req.status === 'delivered' || req.status === 'confirmed' || req.status === 'partial' || req.status === 'fulfilled') {
    derived.push({ status: 'accepted', notes: 'Приета от администратор', created_at: req.accepted_at || req.updated_at })
  }
  if (req.in_transit_at || req.status === 'in_transit' || req.status === 'delivered' || req.status === 'confirmed' || req.status === 'partial') {
    derived.push({ status: 'in_transit', notes: 'Изпратена към магазина', created_at: req.in_transit_at || req.updated_at })
  }
  if (req.delivered_at || req.status === 'delivered' || req.status === 'confirmed' || req.status === 'partial') {
    derived.push({ status: 'delivered', notes: 'Доставена в магазина', created_at: req.delivered_at || req.updated_at })
  }
  if (req.status === 'confirmed' || req.status === 'partial' || req.status === 'fulfilled') {
    derived.push({
      status: req.status === 'partial' ? 'partial' : 'confirmed',
      notes: req.status === 'partial' ? 'Потвърдено частично получаване' : 'Потвърдено получаване',
      created_at: req.updated_at || req.created_at,
    })
  }

  return NextResponse.json(derived)
}
```

- [ ] **Step 2: Verify TypeScript**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/[id]/events/route.ts
git commit -m "fix: events endpoint uses real table, adds new status fallback"
```

---

### Task 9: Update Requests List Endpoint

**Files:**
- Modify: `src/app/api/inventory/requests/route.ts`

- [ ] **Step 1: Add requested_by to select, add status mapping**

Update the select at line 13 to include more fields:

```typescript
  let query = (supabase.from('stock_requests') as any)
    .select('id, product:products(name), store:stores(name), requested_by, requested_qty, status, notes, created_at, accepted_at, in_transit_at, delivered_at')
```

Update the mapping at lines 17-25:

```typescript
  const requests = (data || []).map((r: any) => ({
    id: r.id,
    product_id: r.product_id,
    product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
    store_id: r.store_id,
    store_name: Array.isArray(r.store) ? r.store[0]?.name : r.store?.name,
    requested_by: r.requested_by,
    quantity: r.requested_qty,
    status: r.status,
    notes: r.notes,
    created_at: r.created_at,
    accepted_at: r.accepted_at,
    in_transit_at: r.in_transit_at,
    delivered_at: r.delivered_at,
  }))
```

- [ ] **Step 2: Verify TypeScript**

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/requests/route.ts
git commit -m "feat: requests list includes new status timestamps and requested_by"
```

---

### Task 10: Admin Split Panel UI

**Files:**
- Modify: `src/app/(admin)/requests/requests-client.tsx`

This is the largest task. Replace the entire component with the split-panel design.

- [ ] **Step 1: Update STATUS constants**

```typescript
const STATUS_LABEL: Record<string, string> = {
  pending: 'Чакаща',
  accepted: 'Приета',
  in_transit: 'На път',
  delivered: 'Доставена',
  fulfilled: 'Изпълнена',
  confirmed: 'Потвърдена',
  partial: 'Частична',
  rejected: 'Отказана',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  accepted: 'bg-sky-100 text-sky-800 border-sky-200',
  in_transit: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  delivered: 'bg-teal-100 text-teal-800 border-teal-200',
  fulfilled: 'bg-blue-100 text-blue-800 border-blue-200',
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  partial: 'bg-orange-100 text-orange-800 border-orange-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
}

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-amber-500',
  accepted: 'bg-sky-500',
  in_transit: 'bg-indigo-500',
  delivered: 'bg-teal-500',
  fulfilled: 'bg-blue-500',
  confirmed: 'bg-green-500',
  partial: 'bg-orange-500',
  rejected: 'bg-red-500',
}

const NEXT_ACTION: Record<string, { label: string; endpoint: string } | null> = {
  pending: { label: 'Приеми', endpoint: 'accept' },
  accepted: { label: 'Изпрати', endpoint: 'ship' },
  in_transit: { label: 'Достави', endpoint: 'deliver' },
  delivered: null, // seller confirms
  confirmed: null,
  partial: null,
  rejected: null,
}
```

- [ ] **Step 2: Rewrite component with split panel layout**

Replace the return JSX with:

```tsx
return (
  <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
      <p className="text-muted-foreground text-sm mt-1">
        {pendingCount} чакащи · {doneCount} обработени
      </p>
    </div>

    <div className="flex gap-4 h-[calc(100vh-12rem)]">
      {/* Left panel — batch list */}
      <div className="w-1/3 min-w-[320px] overflow-y-auto space-y-3 pr-2">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['pending', 'in_progress', 'done'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                activeTab === tab ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {{pending: 'Чакащи', in_progress: 'В процес', done: 'Приключени'}[tab]}
              {tab === 'pending' && pendingCount > 0 && (
                <span className="ml-1 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Batch list */}
        {filteredBatches.map(b => (
          <button
            key={b.key}
            onClick={() => setSelectedBatch(b)}
            className={`w-full text-left rounded-xl border p-4 transition-all ${
              selectedBatch?.key === b.key
                ? 'ring-2 ring-blue-400 border-blue-300 bg-blue-50/50'
                : 'bg-white hover:shadow-md'
            }`}
          >
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-slate-500 shrink-0" />
              <span className="font-bold text-sm truncate">{b.store_name}</span>
              <div className={`w-2 h-2 rounded-full ${STATUS_DOT[b.status]}`} />
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline" className={`text-[10px] ${STATUS_COLOR[b.status]}`}>
                {STATUS_LABEL[b.status]}
              </Badge>
              <span className="text-xs text-muted-foreground">{relativeTime(b.created_at)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{b.productCount} продукта · {b.totalQty} бр.</p>
          </button>
        ))}
        {filteredBatches.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">Няма заявки</p>
        )}
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {selectedBatch ? (
          <div className="space-y-4">
            {/* Header + quick action */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{selectedBatch.store_name}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedBatch.productCount} продукта · {selectedBatch.totalQty} бр. · {relativeTime(selectedBatch.created_at)}
                </p>
              </div>
              <div className="flex gap-2">
                {selectedBatch.status === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" className="text-red-600"
                      onClick={() => handleAction(selectedBatch, 'reject')}>
                      Откажи
                    </Button>
                    <Button size="sm" onClick={() => handleAction(selectedBatch, 'accept')}>
                      Приеми
                    </Button>
                  </>
                )}
                {selectedBatch.status === 'accepted' && (
                  <Button size="sm" onClick={() => openFulfill(selectedBatch.store_id, selectedBatch.store_name, selectedBatch.entries)}>
                    Прехвърли и изпрати
                  </Button>
                )}
                {selectedBatch.status === 'in_transit' && (
                  <Button size="sm" onClick={() => handleAction(selectedBatch, 'deliver')}>
                    Маркирай като доставена
                  </Button>
                )}
              </div>
            </div>

            {/* Products list */}
            <div className="border rounded-xl divide-y">
              {selectedBatch.entries.map(e => (
                <div key={e.id} className="p-3 flex items-center justify-between">
                  <span className="font-medium text-sm truncate">{e.product_name}</span>
                  <span className="text-sm font-bold tabular-nums">{e.quantity} бр.</span>
                </div>
              ))}
            </div>

            {/* Comments */}
            <RequestNotes requestId={selectedBatch.entries[0]?.id} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Изберете заявка от списъка
          </div>
        )}
      </div>
    </div>

    {/* Fulfill dialog (same as current) */}
    {/* ... keep existing fulfillStore dialog ... */}
  </div>
)
```

- [ ] **Step 3: Add RequestNotes component inline**

```typescript
function RequestNotes({ requestId }: { requestId: string }) {
  const [notes, setNotes] = useState<any[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch(`/api/inventory/requests/${requestId}/notes`)
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setNotes(d) }).catch(() => {})
  }, [requestId])

  const send = async () => {
    if (!text.trim()) return
    setSending(true)
    const res = await fetch(`/api/inventory/requests/${requestId}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    })
    if (res.ok) {
      const note = await res.json()
      setNotes(prev => [...prev, note])
      setText('')
    }
    setSending(false)
  }

  return (
    <div className="border rounded-xl p-4">
      <h3 className="text-sm font-medium mb-3">Коментари</h3>
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Няма коментари</p>
      ) : (
        <div className="space-y-2 mb-3 max-h-60 overflow-y-auto">
          {notes.map(n => (
            <div key={n.id} className="text-sm">
              <span className="font-medium">{n.user_name || '—'}</span>
              <span className="text-xs text-muted-foreground ml-2">
                {new Date(n.created_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <p className="mt-0.5">{n.body}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={text} onChange={e => setText(e.target.value)} placeholder="Напишете коментар..."
          className="h-8 text-sm" onKeyDown={e => e.key === 'Enter' && send()} />
        <Button size="sm" onClick={send} disabled={sending || !text.trim()}>Изпрати</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add batch filtering + handleAction logic**

```typescript
const [activeTab, setActiveTab] = useState('pending')
const [selectedBatch, setSelectedBatch] = useState<any>(null)

const filteredBatches = useMemo(() => {
  if (activeTab === 'pending') return batches
  if (activeTab === 'in_progress') return [...batches.filter((b: any) => !['pending', 'confirmed', 'partial', 'rejected'].includes(b.status)), ...historyBatches.filter((b: any) => !['confirmed', 'partial', 'rejected'].includes(b.status))]
  return historyBatches
}, [activeTab, batches, historyBatches])

const handleAction = async (batch: any, action: string) => {
  for (const entry of batch.entries) {
    setLoading(entry.id)
    await fetch(`/api/inventory/requests/${entry.id}/${action}`, { method: 'POST' })
  }
  setRequests(prev => prev.map(r =>
    batch.entries.some((e: any) => e.id === r.id)
      ? { ...r, status: action === 'accept' ? 'accepted' : action === 'ship' ? 'in_transit' : action === 'deliver' ? 'delivered' : 'rejected' }
      : r
  ))
  setSelectedBatch(null)
  setLoading(null)
  router.refresh()
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/app/(admin)/requests/requests-client.tsx
git commit -m "feat: admin split-panel request UI with new statuses and comments"
```

---

### Task 11: Seller Requests Page

**Files:**
- Create: `src/app/(seller)/requests/page.tsx`
- Create: `src/components/inventory/seller-request-form.tsx`

- [ ] **Step 1: Write seller request form component**

```typescript
// src/components/inventory/seller-request-form.tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Plus, X, Send } from 'lucide-react'

interface Product {
  id: string; name: string; price: number | null; quantity_on_hand: number
}

interface RequestItem {
  product: Product; qty: number; notes?: string
}

export function SellerRequestForm({ products: allProducts }: { products: Product[] }) {
  const [search, setSearch] = useState('')
  const [basket, setBasket] = useState<RequestItem[]>([])
  const [sending, setSending] = useState(false)

  const filtered = allProducts.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 50)

  const addToBasket = (product: Product) => {
    setBasket(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product, qty: 1 }]
    })
  }

  const removeFromBasket = (productId: string) => {
    setBasket(prev => prev.filter(i => i.product.id !== productId))
  }

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) { removeFromBasket(productId); return }
    setBasket(prev => prev.map(i => i.product.id === productId ? { ...i, qty } : i))
  }

  const sendRequest = async () => {
    if (basket.length === 0) return
    setSending(true)
    try {
      const res = await fetch('/api/inventory/request-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: basket.map(i => ({ product_id: i.product.id, quantity: i.qty })),
        }),
      })
      if (res.ok) {
        setBasket([])
        setSearch('')
      }
    } finally { setSending(false) }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Търсене на продукт..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {search && (
        <div className="border rounded-xl divide-y max-h-64 overflow-y-auto">
          {filtered.map(p => (
            <div key={p.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.quantity_on_hand} бр. · {p.price?.toFixed(2)} €</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => addToBasket(p)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground text-center">Няма съвпадения</p>
          )}
        </div>
      )}

      {basket.length > 0 && (
        <div className="border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium">Заявка ({basket.length})</h3>
          {basket.map(item => (
            <div key={item.product.id} className="flex items-center gap-2">
              <span className="text-sm flex-1 truncate">{item.product.name}</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => updateQty(item.product.id, item.qty - 1)}>−</Button>
                <span className="w-8 text-center text-sm tabular-nums">{item.qty}</span>
                <Button variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => updateQty(item.product.id, item.qty + 1)}>+</Button>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                onClick={() => removeFromBasket(item.product.id)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button className="w-full" onClick={sendRequest} disabled={sending}>
            <Send className="mr-2 h-4 w-4" />
            {sending ? 'Изпращане...' : 'Изпрати заявка'}
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write seller requests page with tabs**

```typescript
// src/app/(seller)/requests/page.tsx
import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SellerRequestForm } from '@/components/inventory/seller-request-form'

export const dynamic = 'force-dynamic'

export default async function SellerRequestsPage() {
  const user = await requireAuth()
  await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()

  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, price, quantity_on_hand')
    .eq('status', 'active')
    .order('name')

  const { data: myRequests } = await (supabase.from('stock_requests') as any)
    .select('id, product:products(name), requested_qty, status, notes, created_at')
    .eq('requested_by', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = (myRequests || []).map((r: any) => ({
    id: r.id,
    product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
    quantity: r.requested_qty,
    status: r.status,
    notes: r.notes,
    created_at: r.created_at,
  }))

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Чакаща', accepted: 'Приета', in_transit: 'На път',
    delivered: 'Доставена', fulfilled: 'Изпълнена',
    confirmed: 'Потвърдена', partial: 'Частична', rejected: 'Отказана',
  }
  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800', accepted: 'bg-sky-100 text-sky-800',
    in_transit: 'bg-indigo-100 text-indigo-800', delivered: 'bg-teal-100 text-teal-800',
    fulfilled: 'bg-blue-100 text-blue-800', confirmed: 'bg-green-100 text-green-800',
    partial: 'bg-orange-100 text-orange-800', rejected: 'bg-red-100 text-red-800',
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Заявки</h1>
      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        <a href="?tab=request" className="px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600">Заяви</a>
        <a href="?tab=my" className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Моите заявки</a>
      </div>
      <SellerRequestForm products={(products || []) as any} />
      {/* My requests list */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-bold">Моите заявки</h2>
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
              <div>
                <p className="text-sm font-medium">{r.product_name}</p>
                <p className="text-xs text-muted-foreground">{r.quantity} бр. · {new Date(r.created_at).toLocaleDateString('bg-BG')}</p>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded font-medium ${STATUS_COLOR[r.status]}`}>
                {STATUS_LABEL[r.status] || r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Actually this needs to be a client component for tabs to work. Let me simplify — use URL searchParams for the tab:

```typescript
// src/app/(seller)/requests/page.tsx
import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { SellerRequestsClient } from './client'

export const dynamic = 'force-dynamic'

export default async function SellerRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireAuth()
  await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()
  const sp = await searchParams
  const activeTab = sp.tab || 'request'

  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, price, quantity_on_hand')
    .eq('status', 'active')
    .order('name')

  let myRequests: any[] = []
  if (activeTab === 'my') {
    const { data } = await (supabase.from('stock_requests') as any)
      .select('id, product:products(name), requested_qty, status, notes, created_at, accepted_at, in_transit_at, delivered_at')
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    myRequests = (data || []).map((r: any) => ({
      id: r.id,
      product_name: Array.isArray(r.product) ? r.product[0]?.name : r.product?.name,
      quantity: r.requested_qty,
      status: r.status,
      notes: r.notes,
      created_at: r.created_at,
      accepted_at: r.accepted_at,
      in_transit_at: r.in_transit_at,
      delivered_at: r.delivered_at,
    }))
  }

  return <SellerRequestsClient products={products || []} myRequests={myRequests} activeTab={activeTab} requestId={user.id} />
}
```

And a client component:

```typescript
// src/app/(seller)/requests/client.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Search, Plus, X, Send, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

// ... inline SellerRequestForm code + tab switching + my requests list

export function SellerRequestsClient({ products, myRequests, activeTab, requestId }: any) {
  const router = useRouter()
  const [tab, setTab] = useState(activeTab)

  const switchTab = (t: string) => {
    setTab(t)
    router.push(`/requests?tab=${t}`)
  }

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Чакаща', accepted: 'Приета', in_transit: 'На път',
    delivered: 'Доставена', fulfilled: 'Изпълнена',
    confirmed: 'Потвърдена', partial: 'Частична', rejected: 'Отказана',
  }
  const STATUS_COLOR: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800', accepted: 'bg-sky-100 text-sky-800',
    in_transit: 'bg-indigo-100 text-indigo-800', delivered: 'bg-teal-100 text-teal-800',
    fulfilled: 'bg-blue-100 text-blue-800', confirmed: 'bg-green-100 text-green-800',
    partial: 'bg-orange-100 text-orange-800', rejected: 'bg-red-100 text-red-800',
  }

  // ... request form state + basket logic (same as above)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Заявки</h1>
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => switchTab('request')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'request' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-muted-foreground'}`}>
          Заяви
        </button>
        <button onClick={() => switchTab('my')}
          className={`px-4 py-2 text-sm font-medium ${tab === 'my' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-muted-foreground'}`}>
          Моите заявки
          {myRequests.length > 0 && (
            <span className="ml-1.5 text-[10px] bg-slate-200 px-1.5 py-0.5 rounded-full">{myRequests.length}</span>
          )}
        </button>
      </div>

      {tab === 'request' ? (
        /* SellerRequestForm inline */
        <div className="space-y-4">
          {/* ... product search + basket ... */}
        </div>
      ) : (
        <div className="space-y-2">
          {myRequests.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">Нямате заявки</p>
          ) : (
            myRequests.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.product_name}</p>
                  <p className="text-xs text-muted-foreground">{r.quantity} бр. · {new Date(r.created_at).toLocaleDateString('bg-BG')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-[10px] ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</Badge>
                  {r.status === 'delivered' && (
                    <Button size="sm" onClick={() => confirmReceipt(r.id, r.quantity)}>Потвърди</Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add confirmReceipt handler**

```typescript
const confirmReceipt = async (id: string, qty: number) => {
  await fetch(`/api/inventory/requests/${id}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ received_qty: qty }),
  })
  router.refresh()
}
```

- [ ] **Step 4: Verify TypeScript compiles**

- [ ] **Step 5: Commit**

```bash
git add src/app/(seller)/requests/
git add src/components/inventory/seller-request-form.tsx
git commit -m "feat: seller requests page with Заяви/Моите заявки tabs"
```

---

### Task 12: Add Seller Nav Item + Wire Up

**Files:**
- Modify: `src/app/(seller)/layout-client.tsx`
- Modify: `src/app/(seller)/low-stock/page.tsx`

- [ ] **Step 1: Add requests nav item**

In `layout-client.tsx`, add to navItems in the layout.tsx:

Check `src/app/(seller)/layout.tsx` — add to navItems array:

```typescript
const navItems = [
  { href: '/record-sale', label: 'Запиши продажба' },
  { href: '/my-sales', label: 'Моите продажби' },
  { href: '/requests', label: 'Заявки' },
  { href: '/low-stock', label: 'Ниски наличности' },
]
```

Also add icon mapping:

```typescript
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  '/record-sale': ShoppingBag,
  '/my-sales': BarChart3,
  '/requests': Bell,
  '/low-stock': AlertTriangle,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(seller)/layout-client.tsx src/app/(seller)/layout.tsx
git commit -m "feat: add Заявки nav item for seller"
```

---

## Implementation Order (Dependency Chain)

```
Task 1 (migration) → Tasks 2-9 (API endpoints, parallel)
→ Task 10 (admin UI) → Task 11 (seller UI) → Task 12 (nav wiring)
```

Tasks 2-9 have no dependencies on each other and can be done in parallel.

## Testing Checklist

- [ ] Migration runs without errors
- [ ] request_notes table accepts INSERT and SELECT
- [ ] request_events table accepts INSERT and SELECT
- [ ] accept/ship/deliver endpoints work in sequence
- [ ] reject works with admin client
- [ ] confirm works with new statuses
- [ ] notes: admin and seller can both write and read
- [ ] Admin UI: batch list filters correctly by tab
- [ ] Admin UI: quick action buttons change status correctly
- [ ] Admin UI: comments appear in real time
- [ ] Seller UI: product search works
- [ ] Seller UI: basket → batch request creates pending requests
- [ ] Seller UI: status badges update
- [ ] Seller UI: confirm button appears at delivered status
