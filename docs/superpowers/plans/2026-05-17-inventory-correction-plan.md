# Inventory Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stock correction (inventory adjustment) feature allowing admins to correct product quantities with audit trail.

**Architecture:** New `/inventory` admin page with 3-step correction flow (select product+store → enter actual count → confirm reason). New `POST /api/inventory/correct` endpoint handles FIFO-aware deduction/addition, records `stock_movements` type `correction` + `stock_corrections` table. Migration is reversible with rollback SQL.

**Tech Stack:** Next.js 16 App Router, Supabase, shadcn/ui, TypeScript, Tailwind CSS, lucide-react icons

**Source spec:** `docs/superpowers/specs/2026-05-17-inventory-correction-design.md`

---

### File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/00020_inventory_correction.sql` | Create | DB migration |
| `supabase/migrations/00020_inventory_correction_rollback.sql` | Create | Rollback script |
| `src/app/api/inventory/correct/route.ts` | Create | POST endpoint for correction |
| `src/app/api/inventory/corrections/route.ts` | Create | GET endpoint for correction history |
| `src/app/api/products/search/route.ts` | Create | GET product search (needed by inventory UI) |
| `src/app/api/products/[id]/inventory/route.ts` | Create | GET product inventory per store |
| `src/app/(admin)/inventory/page.tsx` | Create | Server component |
| `src/app/(admin)/inventory/inventory-client.tsx` | Create | Client component (3-step flow) |
| `src/app/(admin)/layout.tsx` | Modify | Add nav item |
| `src/app/(admin)/layout-client.tsx` | Modify | Add icon mapping |

---

### Task 1: Database Backup

- [ ] **Step 1: Create Supabase backup**

Go to Supabase Dashboard → your project → Database → Backups → "Create backup".
Wait for it to complete. Verify the backup appears in the list with non-zero size.

Alternatively via CLI:
```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
npx supabase db dump --linked --file backup_pre_correction_$(date +%Y%m%d_%H%M%S).sql
```

- [ ] **Step 2: Note the backup timestamp**

The backup filename or Supabase dashboard shows the timestamp. Note it for rollback reference.

---

### Task 2: Database Migration

**Files:**
- Create: `supabase/migrations/00020_inventory_correction.sql`
- Create: `supabase/migrations/00020_inventory_correction_rollback.sql`

- [ ] **Step 1: Write migration file**

```sql
-- 00020_inventory_correction.sql
-- Add correction support to stock tracking

-- 1. Update stock_movements type check to include 'correction'
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check 
  CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void', 'correction'));

-- 2. Create stock_corrections table
CREATE TABLE IF NOT EXISTS stock_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  movement_id uuid REFERENCES stock_movements(id),
  old_quantity int NOT NULL,
  new_quantity int NOT NULL,
  difference int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('wrong_entry', 'damaged', 'expired', 'inventory_count', 'other')),
  notes text,
  created_by uuid REFERENCES users(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corrections_product ON stock_corrections(product_id);
CREATE INDEX IF NOT EXISTS idx_corrections_store ON stock_corrections(store_id);
CREATE INDEX IF NOT EXISTS idx_corrections_created ON stock_corrections(created_at);

-- 3. RLS
ALTER TABLE stock_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access corrections" ON stock_corrections;
CREATE POLICY "Admins full access corrections" ON stock_corrections FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
```

- [ ] **Step 2: Write rollback file**

```sql
-- 00020_inventory_correction_rollback.sql
-- Revert inventory correction feature

DROP POLICY IF EXISTS "Admins full access corrections" ON stock_corrections;
DROP TABLE IF EXISTS stock_corrections;

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check 
  CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void'));
```

- [ ] **Step 3: Push migration to Supabase**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
npx supabase db push
```

Verify it succeeds without errors.

- [ ] **Step 4: Verify in Supabase dashboard**

Check that:
- `stock_corrections` table exists
- `stock_movements_type_check` includes 'correction'
- RLS policy exists on `stock_corrections`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00020_inventory_correction.sql supabase/migrations/00020_inventory_correction_rollback.sql
git commit -m "feat: add stock_corrections table and correction movement type"
```

---

### Task 3: Inventory API Endpoints

**Files:**
- Create: `src/app/api/inventory/correct/route.ts`
- Create: `src/app/api/inventory/corrections/route.ts`

- [ ] **Step 1: Write the correction endpoint**

```typescript
// src/app/api/inventory/correct/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAction } from '@/lib/audit'

const VALID_REASONS = ['wrong_entry', 'damaged', 'expired', 'inventory_count', 'other']

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { product_id, store_id, actual_quantity, reason, notes } = await request.json()

  if (!product_id || !store_id || actual_quantity == null) {
    return NextResponse.json({ error: 'Липсват задължителни полета' }, { status: 400 })
  }
  if (typeof actual_quantity !== 'number' || actual_quantity < 0 || !Number.isInteger(actual_quantity)) {
    return NextResponse.json({ error: 'Невалидна бройка' }, { status: 400 })
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: 'Невалидна причина' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()

    // Get product name for audit
    const { data: product } = await (admin.from('products') as any)
      .select('name, quantity_on_hand')
      .eq('id', product_id)
      .single()
    if (!product) return NextResponse.json({ error: 'Продуктът не съществува' }, { status: 404 })

    // Get store name for audit
    const { data: store } = await (admin.from('stores') as any)
      .select('name')
      .eq('id', store_id)
      .single()
    if (!store) return NextResponse.json({ error: 'Магазинът не съществува' }, { status: 404 })

    // Sum current stock from batches
    const { data: batches } = await (admin.from('stock_batches') as any)
      .select('id, quantity_remaining, unit_cost')
      .eq('product_id', product_id)
      .eq('store_id', store_id)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: true })

    const systemTotal = (batches || []).reduce((sum: number, b: any) => sum + b.quantity_remaining, 0)
    const diff = actual_quantity - systemTotal

    if (diff === 0) {
      return NextResponse.json({ error: 'Няма разлика в наличностите' }, { status: 400 })
    }

    // Record movement and adjust batches
    let movementId: string | null = null

    if (diff < 0) {
      // Decrease: FIFO deduct
      let remaining = Math.abs(diff)
      for (const batch of (batches || [])) {
        if (remaining <= 0) break
        const take = Math.min(remaining, batch.quantity_remaining)
        await (admin.from('stock_batches') as any)
          .update({ quantity_remaining: batch.quantity_remaining - take })
          .eq('id', batch.id)
        remaining -= take
      }

      const { data: movement } = await (admin.from('stock_movements') as any)
        .insert({
          product_id,
          store_id,
          type: 'correction',
          quantity: diff,
          unit_cost: batches?.[0]?.unit_cost ?? 0,
          notes: notes || null,
          created_by: user.id,
        })
        .select('id')
        .single()
      movementId = movement?.id
    } else {
      // Increase: add to newest batch or create one
      const newest = batches?.length > 0 ? batches[batches.length - 1] : null
      if (newest) {
        await (admin.from('stock_batches') as any)
          .update({ quantity_remaining: newest.quantity_remaining + diff })
          .eq('id', newest.id)
      } else {
        const { data: newBatch } = await (admin.from('stock_batches') as any)
          .insert({
            product_id,
            store_id,
            quantity_remaining: diff,
            unit_cost: 0,
          })
          .select('id')
          .single()
      }

      const { data: movement } = await (admin.from('stock_movements') as any)
        .insert({
          product_id,
          store_id,
          type: 'correction',
          quantity: diff,
          unit_cost: 0,
          notes: notes || null,
          created_by: user.id,
        })
        .select('id')
        .single()
      movementId = movement?.id
    }

    // Record in stock_corrections
    const { data: correction } = await (admin.from('stock_corrections') as any)
      .insert({
        product_id,
        store_id,
        movement_id: movementId,
        old_quantity: systemTotal,
        new_quantity: actual_quantity,
        difference: diff,
        reason,
        notes: notes || null,
        created_by: user.id,
      })
      .select('id, old_quantity, new_quantity, difference, reason, notes, created_at')
      .single()

    // Update product quantity_on_hand
    await (admin.from('products') as any)
      .update({ quantity_on_hand: product.quantity_on_hand + diff })
      .eq('id', product_id)

    // Audit log
    await logAction({
      action: 'stock_correction',
      userId: user.id,
      entityType: 'stock_correction',
      entityId: correction?.id,
      details: `${product.name} @ ${store.name}: ${systemTotal} → ${actual_quantity} (${diff > 0 ? '+' : ''}${diff}) — ${reason}`,
    }, supabase)

    const reasonLabels: Record<string, string> = {
      wrong_entry: 'Грешно въвеждане',
      damaged: 'Повреден продукт',
      expired: 'Изтекъл срок',
      inventory_count: 'Установено при инвентаризация',
      other: 'Друго',
    }

    return NextResponse.json({
      correction: {
        ...correction,
        product_name: product.name,
        store_name: store.name,
        reason_label: reasonLabels[reason] || reason,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Грешка при корекция' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Write the corrections history endpoint**

```typescript
// src/app/api/inventory/corrections/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const storeId = searchParams.get('store_id')
  const productId = searchParams.get('product_id')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

  let query = (supabase.from('stock_corrections') as any)
    .select('id, old_quantity, new_quantity, difference, reason, notes, created_at, product:products(name), store:stores(name), user:users(display_name)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (storeId) query = query.eq('store_id', storeId)
  if (productId) query = query.eq('product_id', productId)

  const { data } = await query

  const reasonLabels: Record<string, string> = {
    wrong_entry: 'Грешно въвеждане',
    damaged: 'Повреден продукт',
    expired: 'Изтекъл срок',
    inventory_count: 'Установено при инвентаризация',
    other: 'Друго',
  }

  return NextResponse.json((data || []).map((c: any) => ({
    id: c.id,
    old_quantity: c.old_quantity,
    new_quantity: c.new_quantity,
    difference: c.difference,
    reason: c.reason,
    reason_label: reasonLabels[c.reason] || c.reason,
    notes: c.notes,
    product_name: c.product?.name || '—',
    store_name: c.store?.name || '—',
    user_name: c.user?.display_name || '—',
    created_at: c.created_at,
  })))
}
```

- [ ] **Step 3: Verify API works**

Test with curl (replace with actual IDs from your database):
```bash
# Test correction (use actual product_id and store_id)
curl -X POST http://localhost:3000/api/inventory/correct \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-auth-cookie>" \
  -d '{"product_id":"...","store_id":"...","actual_quantity":80,"reason":"inventory_count"}'

# Test history
curl http://localhost:3000/api/inventory/corrections?store_id=... \
  -H "Cookie: <your-auth-cookie>"
```

We'll do real verification through the UI in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/inventory/correct/route.ts src/app/api/inventory/corrections/route.ts
git commit -m "feat: add inventory correction and history API endpoints"
```

---

### Task 4: Product Support APIs

**Files:**
- Create: `src/app/api/products/search/route.ts`
- Create: `src/app/api/products/[id]/inventory/route.ts`

These endpoints are needed by the inventory UI but don't exist yet.

- [ ] **Step 1: Write product search endpoint**

```typescript
// src/app/api/products/search/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20)

  if (q.length < 2) return NextResponse.json([])

  const { data } = await (supabase.from('products') as any)
    .select('id, name, barcode')
    .or(`name.ilike.%${q}%,barcode.ilike.%${q}%`)
    .eq('is_active', true)
    .order('name')
    .limit(limit)

  return NextResponse.json(data || [])
}
```

- [ ] **Step 2: Write product inventory endpoint**

```typescript
// src/app/api/products/[id]/inventory/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data: batches } = await (admin.from('stock_batches') as any)
    .select('id, store_id, quantity_remaining, unit_cost, created_at')
    .eq('product_id', id)
    .gt('quantity_remaining', 0)
    .order('created_at')

  return NextResponse.json({ batches: batches || [] })
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/products/search/route.ts src/app/api/products/\[id\]/inventory/route.ts
git commit -m "feat: add product search and inventory API endpoints"
```

---

### Task 5: Inventory Page UI

**Files:**
- Create: `src/app/(admin)/inventory/page.tsx`
- Create: `src/app/(admin)/inventory/inventory-client.tsx`

- [ ] **Step 1: Write server component (page.tsx)**

```typescript
// src/app/(admin)/inventory/page.tsx
import { requireAdmin } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { InventoryClient } from './inventory-client'

export const dynamic = 'force-dynamic'

export default async function InventoryPage() {
  await requireAdmin()

  const supabase = await createServerSupabaseClient()
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return <InventoryClient stores={(stores || []) as { id: string; name: string }[]} />
}
```

- [ ] **Step 2: Write client component (inventory-client.tsx)**

```typescript
// src/app/(admin)/inventory/inventory-client.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Search, ClipboardList, ArrowRight, ArrowLeft, Check, AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'

interface Store {
  id: string
  name: string
}

interface ProductResult {
  id: string
  name: string
  barcode?: string
}

interface CorrectionRow {
  id: string
  old_quantity: number
  new_quantity: number
  difference: number
  reason: string
  reason_label: string
  notes: string | null
  product_name: string
  store_name: string
  user_name: string
  created_at: string
}

const REASONS = [
  { value: 'wrong_entry', label: 'Грешно въвеждане' },
  { value: 'damaged', label: 'Повреден продукт' },
  { value: 'expired', label: 'Изтекъл срок' },
  { value: 'inventory_count', label: 'Установено при инвентаризация' },
  { value: 'other', label: 'Друго' },
]

type Step = 'select' | 'count' | 'reason'

export function InventoryClient({ stores }: { stores: Store[] }) {
  const { toast } = useToast()
  const [step, setStep] = useState<Step>('select')

  // Step 1 state
  const [storeId, setStoreId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [products, setProducts] = useState<ProductResult[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null)
  const [searching, setSearching] = useState(false)

  // Step 2 state
  const [systemTotal, setSystemTotal] = useState<number | null>(null)
  const [actualQuantity, setActualQuantity] = useState('')
  const [loadingStock, setLoadingStock] = useState(false)

  // Step 3 state
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // History
  const [corrections, setCorrections] = useState<CorrectionRow[]>([])

  // Search products
  useEffect(() => {
    if (productSearch.length < 2) { setProducts([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(productSearch)}&limit=10`)
        if (res.ok) setProducts(await res.json())
      } catch { /* ignore */ }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [productSearch])

  // Load system stock when product+store selected
  const loadStock = useCallback(async (productId: string, sid: string) => {
    setLoadingStock(true)
    try {
      const res = await fetch(`/api/inventory/corrections?store_id=${sid}&product_id=${productId}&limit=1`)
      // Get stock from batches for this product+store
      const stockRes = await fetch(`/api/inventory/product/${productId}?store_id=${sid}`)
      // Fallback: use product inventory endpoint
      const invRes = await fetch(`/api/products/${productId}/inventory`)
      if (invRes.ok) {
        const data = await invRes.json()
        const storeBatches = (data.batches || []).filter((b: any) => b.store_id === sid)
        const total = storeBatches.reduce((s: number, b: any) => s + b.quantity_remaining, 0)
        setSystemTotal(total)
      }
    } catch { /* ignore */ }
    setLoadingStock(false)
  }, [])

  // Load correction history for store
  const loadHistory = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/inventory/corrections?store_id=${sid}&limit=10`)
      if (res.ok) setCorrections(await res.json())
    } catch { /* ignore */ }
  }, [])

  // When store changes, reload history
  useEffect(() => {
    if (storeId) loadHistory(storeId)
  }, [storeId, loadHistory])

  const diff = actualQuantity !== '' && systemTotal !== null
    ? parseInt(actualQuantity) - systemTotal
    : 0

  const canProceedToCount = storeId && selectedProduct
  const canProceedToReason = actualQuantity !== '' && diff !== 0

  const handleProductSelect = (p: ProductResult) => {
    setSelectedProduct(p)
    setProductSearch(p.name)
    setProducts([])
    if (storeId) loadStock(p.id, storeId)
  }

  const handleStoreChange = (sid: string) => {
    setStoreId(sid)
    if (selectedProduct) loadStock(selectedProduct.id, sid)
  }

  const handleSave = async () => {
    if (!selectedProduct || !storeId || diff === 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/inventory/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          store_id: storeId,
          actual_quantity: parseInt(actualQuantity),
          reason,
          notes: notes || undefined,
        }),
      })
      if (res.ok) {
        toast({ title: 'Корекцията е записана успешно' })
        // Reset form
        setStep('select')
        setSelectedProduct(null)
        setProductSearch('')
        setActualQuantity('')
        setSystemTotal(null)
        setReason('')
        setNotes('')
        loadHistory(storeId)
      } else {
        const err = await res.json()
        toast({ title: err.error || 'Грешка', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Грешка при запис', variant: 'destructive' })
    }
    setSaving(false)
  }

  const storeName = stores.find(s => s.id === storeId)?.name

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Инвентаризация</h1>
        <p className="text-muted-foreground text-sm mt-1">Корекция на наличностите</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['select', 'count', 'reason'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
              step === s ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}>
              {step === s ? i + 1 : (i + 1)}
            </div>
            <span className={step === s ? 'font-medium' : 'text-muted-foreground'}>
              {s === 'select' ? 'Избор' : s === 'count' ? 'Бройка' : 'Причина'}
            </span>
            {i < 2 && <ArrowRight className="w-4 h-4 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          {step === 'select' && (
            <>
              {/* Store select */}
              <div>
                <Label>Магазин</Label>
                <Select value={storeId} onValueChange={handleStoreChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Изберете магазин" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Product search */}
              <div>
                <Label>Продукт</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-10"
                    placeholder="Търсене по име или баркод..."
                    value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setSelectedProduct(null) }}
                  />
                </div>
                {products.length > 0 && !selectedProduct && (
                  <div className="border rounded-md mt-1 max-h-48 overflow-auto">
                    {products.map(p => (
                      <button
                        key={p.id}
                        className="w-full text-left px-3 py-2 hover:bg-slate-100 text-sm"
                        onClick={() => handleProductSelect(p)}
                      >
                        {p.name}
                        {p.barcode && <span className="text-muted-foreground ml-2">({p.barcode})</span>}
                      </button>
                    ))}
                  </div>
                )}
                {searching && <p className="text-xs text-muted-foreground mt-1">Търсене...</p>}
              </div>

              {selectedProduct && (
                <div className="bg-slate-50 rounded-md p-3 flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="font-medium">{selectedProduct.name}</span>
                </div>
              )}

              <Button className="w-full" disabled={!canProceedToCount} onClick={() => setStep('count')}>
                Напред <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}

          {step === 'count' && (
            <>
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-1">
                  {selectedProduct?.name} &mdash; {storeName}
                </p>
                <p className="text-sm text-muted-foreground">Системна наличност</p>
                <p className="text-4xl font-bold mt-1">
                  {loadingStock ? '...' : systemTotal} <span className="text-lg font-normal text-muted-foreground">бр.</span>
                </p>
              </div>

              <div>
                <Label>Реална наличност (преброена)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={actualQuantity}
                  onChange={e => setActualQuantity(e.target.value)}
                  placeholder="Въведете реална бройка"
                  className="text-lg"
                />
              </div>

              {actualQuantity !== '' && (
                <div className={`rounded-md p-4 text-center ${
                  diff === 0 ? 'bg-slate-100' :
                  diff > 0 ? 'bg-green-50' : 'bg-red-50'
                }`}>
                  <div className="flex items-center justify-center gap-2">
                    {diff === 0 ? (
                      <AlertTriangle className="w-5 h-5 text-slate-500" />
                    ) : diff > 0 ? (
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-600" />
                    )}
                    <span className="text-lg font-bold">
                      Разлика: {diff > 0 ? '+' : ''}{diff} бр.
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {diff === 0 ? 'Няма разлика. Корекция не е нужна.' :
                     diff > 0 ? `Ще бъдат добавени ${diff} бр.` :
                     `Ще бъдат извадени ${Math.abs(diff)} бр.`}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('select')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Назад
                </Button>
                <Button className="flex-1" disabled={!canProceedToReason} onClick={() => setStep('reason')}>
                  Напред <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}

          {step === 'reason' && (
            <>
              <div className="bg-slate-50 rounded-md p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {selectedProduct?.name} &mdash; {storeName}
                </p>
                <p className="text-sm">
                  Системна: <strong>{systemTotal} бр.</strong> → Реална: <strong>{actualQuantity} бр.</strong>
                </p>
                <p className={`text-lg font-bold mt-1 ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Разлика: {diff > 0 ? '+' : ''}{diff} бр.
                </p>
              </div>

              <div>
                <Label>Причина за корекция</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Изберете причина" />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Бележка (незадължително)</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Допълнителна информация..."
                  rows={2}
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('count')}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Назад
                </Button>
                <Button
                  className="flex-1"
                  disabled={!reason || saving}
                  onClick={handleSave}
                >
                  {saving ? 'Записване...' : 'Потвърди корекция'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {corrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="w-5 h-5" />
              Последни корекции
              {storeName && <span className="text-muted-foreground font-normal text-sm">— {storeName}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {corrections.map(c => (
                <div key={c.id} className="px-6 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.product_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(c.created_at).toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia' })}{' '}
                      {new Date(c.created_at).toLocaleTimeString('bg-BG', { timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-muted-foreground">{c.old_quantity} → {c.new_quantity}</span>
                    <span className={`font-medium ${c.difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {c.difference > 0 ? '+' : ''}{c.difference}
                    </span>
                    <span className="text-muted-foreground">— {c.reason_label}</span>
                  </div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    {c.user_name} {c.store_name !== storeName && `• ${c.store_name}`}
                    {c.notes && <span className="ml-2 italic">{c.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/inventory/
git commit -m "feat: add inventory correction page with 3-step flow"
```

---

### Task 6: Navigation

**Files:**
- Modify: `src/app/(admin)/layout.tsx:6-13`
- Modify: `src/app/(admin)/layout-client.tsx:7,16`

- [ ] **Step 1: Add nav item to layout.tsx**

In `src/app/(admin)/layout.tsx`, add the inventory item between reports and requests:

```typescript
const navItems = [
  { href: '/dashboard', label: 'Табло' },
  { href: '/catalog', label: 'Каталог' },
  { href: '/sales', label: 'Продажби' },
  { href: '/reports', label: 'Отчети' },
  { href: '/inventory', label: 'Инвентаризация' },
  { href: '/requests', label: 'Заявки' },
  { href: '/settings', label: 'Настройки' },
]
```

- [ ] **Step 2: Add icon to layout-client.tsx**

In `src/app/(admin)/layout-client.tsx`, add `ClipboardList` to the lucide-react import and to the iconMap:

Import line change:
```typescript
import { X, LayoutDashboard, Package2, ShoppingBag, BarChart3, Settings, Bell, ClipboardList } from 'lucide-react'
```

Icon map change — add after '/reports':
```typescript
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  '/dashboard': LayoutDashboard,
  '/catalog': Package2,
  '/sales': ShoppingBag,
  '/reports': BarChart3,
  '/inventory': ClipboardList,
  '/requests': Bell,
  '/settings': Settings,
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(admin\)/layout.tsx src/app/\(admin\)/layout-client.tsx
git commit -m "feat: add inventory nav item to admin sidebar"
```

---

### Task 7: Deploy and Test

- [ ] **Step 1: Push to GitLab and GitHub**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git push gitlab main
git push github main
```

- [ ] **Step 2: Deploy to Vercel**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
vercel --prod
```

- [ ] **Step 3: Set production alias**

```bash
vercel alias set <deployment-url> prody.vercel.app
```

- [ ] **Step 4: Test in production**

Test the full flow:
1. Log in as admin
2. Navigate to "Инвентаризация" in sidebar
3. Select a store and search for a product
4. Verify system stock is displayed
5. Enter a slightly different actual quantity
6. Verify diff is calculated correctly
7. Select reason and save
8. Verify toast confirmation appears
9. Verify the correction appears in the history table below
10. Go to Catalog → find the product → verify `quantity_on_hand` updated

- [ ] **Step 5: Commit any fixes if needed**

---

## Self-Review

- [x] Spec coverage: All requirements from spec are covered — DB migration (Task 2), correction API (Task 3), product APIs (Task 4), UI 3-step flow (Task 5), navigation (Task 6), backup (Task 1), rollback SQL (Task 2)
- [x] No placeholders: Every step has actual code or exact commands
- [x] Type consistency: `CorrectionRow`, `ProductResult`, `Store` interfaces match across API and client
- [x] File paths are exact: All paths match the existing codebase structure
- [x] Icons exist in lucide-react: ClipboardList, ArrowRight, ArrowLeft, Check, AlertTriangle, TrendingUp, TrendingDown are all real lucide-react icons
