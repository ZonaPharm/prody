# Requests Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign admin requests panel as clear status-colored cards grouped by store+batch, and improve seller comment fields visibility in cart and confirm dialog.

**Architecture:** UI-only changes across 2 existing files. Admin view switches from flat list to batched cards with expandable products, colored status badges, relative timestamps, and prominent action buttons. Seller cart gets full-width comment input and improved confirm dialog with comment field. No new endpoints or DB changes.

**Tech Stack:** Next.js 16 + React + Tailwind CSS + shadcn/ui + lucide-react (existing stack)

---

## File Map

| File | Purpose |
|------|---------|
| `src/app/(admin)/requests/requests-client.tsx` | Admin panel — complete rewrite of layout |
| `src/app/(seller)/low-stock/low-stock-client.tsx` | Seller cart + confirm dialog — targeted edits |

---

### Task 1: Rewrite Admin Requests Client

**Files:**
- Modify: `src/app/(admin)/requests/requests-client.tsx` (entire file)

Rewrite the admin requests view as batched cards with clear status colors, relative timestamps, expandable products, and visible comments.

- [ ] **Step 1: Rewrite imports and constants**

The current file uses these imports. Keep all and add `Clock`:

```typescript
'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Loader2, ArrowRightLeft, Package, Store, ChevronDown, ChevronRight, MessageSquare, Clock } from 'lucide-react'

interface Request {
  id: string
  product_id: string
  product_name: string
  store_id: string
  store_name: string
  quantity: number
  status: string
  notes: string | null
  created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Чакаща',
  fulfilled: 'Изпратена',
  confirmed: 'Потвърдена',
  partial: 'Частична',
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  fulfilled: 'bg-blue-100 text-blue-800 border-blue-200',
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  partial: 'bg-orange-100 text-orange-800 border-orange-200',
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'току-що'
  if (mins < 60) return `преди ${mins} мин`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `преди ${hrs} ч`
  const days = Math.floor(hrs / 24)
  return `преди ${days} д`
}
```

- [ ] **Step 2: Rewrite the component render — header and empty state**

Replace the current render block with the new layout, starting with the header:

```typescript
export function RequestsClient({ requests: initialRequests }: { requests: Request[] }) {
  // ... state (keep existing state declarations exactly as they are) ...

  // Keep existing: toggleBatch, openDetail, openFulfill, executeFulfill, fulfillSingle
  // Keep existing: batches useMemo, historyBatches useMemo

  const pendingCount = requests.filter(r => r.status === 'pending').length
  const doneCount = requests.filter(r => r.status !== 'pending').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {batches.length} чакащи · {historyBatches.length} обработени
        </p>
      </div>

      {batches.length === 0 && historyBatches.length === 0 ? (
        <div className="rounded-xl border bg-white p-16 text-center">
          <Package className="mx-auto h-12 w-12 text-slate-200 mb-4" />
          <p className="text-muted-foreground text-lg">Няма заявки</p>
          <p className="text-muted-foreground text-sm mt-1">Когато продавачи направят заявки, те ще се появят тук</p>
        </div>
      ) : (
        // ... sections
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add pending batches section**

Replace the pending section inside the return:

```typescript
        <div className="space-y-6">
          {batches.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-5 bg-amber-400 rounded-full" />
                <h2 className="text-lg font-bold">Чакащи</h2>
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">{pendingCount} артикула</Badge>
              </div>
              <div className="space-y-3">
                {batches.map(b => {
                  const isExpanded = expandedBatches.has(b.key)
                  return (
                    <div key={b.key} className={`rounded-xl border bg-white shadow-sm transition-all ${isExpanded ? 'ring-2 ring-amber-200 border-amber-300' : 'hover:shadow-md'}`}>
                      {/* Header — clickable to expand */}
                      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none"
                        onClick={() => toggleBatch(b.key)}>
                        <button className="shrink-0 p-1 hover:bg-slate-100 rounded-md transition-colors">
                          {isExpanded ? <ChevronDown className="h-5 w-5 text-slate-500" /> : <ChevronRight className="h-5 w-5 text-slate-500" />}
                        </button>
                        <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Store className="h-5 w-5 text-slate-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-base">{b.store_name}</span>
                            <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_COLOR.pending}`}>Чакаща</Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {relativeTime(b.created_at)}
                            </span>
                          </div>
                          {b.notes && (
                            <p className="text-sm text-slate-600 mt-1 flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              {b.notes}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-1.5">
                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                              <Package className="h-3.5 w-3.5" />
                              {b.productCount} продукта
                            </span>
                            <span className="text-sm font-bold tabular-nums">{b.totalQty} бр. общо</span>
                          </div>
                        </div>
                        <Button size="sm" className="shrink-0 rounded-lg"
                          onClick={e => { e.stopPropagation(); openFulfill(b.store_id, b.store_name, b.entries) }}>
                          <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                          Прехвърли всички
                        </Button>
                      </div>

                      {/* Expanded product list */}
                      {isExpanded && (
                        <div className="border-t border-amber-100 bg-amber-50/30 rounded-b-xl">
                          <div className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Продукти в заявката
                          </div>
                          <div className="divide-y divide-amber-100/50">
                            {b.entries.map(e => (
                              <div key={e.id} className="px-5 py-3 flex items-center justify-between hover:bg-amber-50/50 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-8 w-8 rounded-md bg-white border flex items-center justify-center shrink-0">
                                    <Package className="h-4 w-4 text-slate-400" />
                                  </div>
                                  <span className="text-sm font-medium truncate">{e.product_name}</span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="text-sm font-bold tabular-nums bg-white px-3 py-1 rounded-full border">{e.quantity} бр.</span>
                                  <Button size="sm" variant="ghost" className="text-green-600 hover:bg-green-50 h-8 w-8 p-0 rounded-full"
                                    onClick={() => fulfillSingle(e.id)} disabled={loading === e.id}>
                                    {loading === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
```

- [ ] **Step 4: Add processed batches section**

```typescript
          {historyBatches.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1.5 h-5 bg-slate-300 rounded-full" />
                <h2 className="text-lg font-bold text-muted-foreground">Обработени</h2>
                <span className="text-xs text-muted-foreground">{doneCount} артикула</span>
              </div>
              <div className="space-y-3">
                {historyBatches.map(b => {
                  const isExpanded = expandedBatches.has(b.key)
                  const sc = STATUS_COLOR[b.status] || 'bg-slate-100 text-slate-800 border-slate-200'
                  return (
                    <div key={b.key} className={`rounded-xl border bg-white shadow-sm transition-all opacity-80 hover:opacity-100 ${isExpanded ? 'ring-2 ring-slate-200' : 'hover:shadow-md'}`}>
                      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none"
                        onClick={() => toggleBatch(b.key)}>
                        <button className="shrink-0 p-1 hover:bg-slate-100 rounded-md transition-colors">
                          {isExpanded ? <ChevronDown className="h-5 w-5 text-slate-400" /> : <ChevronRight className="h-5 w-5 text-slate-400" />}
                        </button>
                        <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Store className="h-5 w-5 text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-base">{b.store_name}</span>
                            <Badge variant="outline" className={`text-[10px] font-medium ${sc}`}>{STATUS_LABEL[b.status] || b.status}</Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {relativeTime(b.created_at)}
                            </span>
                          </div>
                          {b.notes && (
                            <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                              {b.notes}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-1.5">
                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                              <Package className="h-3.5 w-3.5" />{b.entries.length} продукта
                            </span>
                            <span className="text-sm font-bold tabular-nums">{b.totalQty} бр.</span>
                          </div>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t bg-slate-50/30 rounded-b-xl">
                          <div className="px-5 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Продукти</div>
                          <div className="divide-y">
                            {b.entries.map(e => (
                              <div key={e.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-100/50 cursor-pointer transition-colors"
                                onClick={() => openDetail(e)}>
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-8 w-8 rounded-md bg-white border flex items-center justify-center shrink-0">
                                    <Package className="h-4 w-4 text-slate-400" />
                                  </div>
                                  <span className="text-sm font-medium truncate">{e.product_name}</span>
                                </div>
                                <span className="text-sm font-bold tabular-nums bg-white px-3 py-1 rounded-full border shrink-0">{e.quantity} бр.</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
```

- [ ] **Step 5: Keep existing dialogs**

The Fulfill Dialog and Detail Dialog stay exactly as they are in the current file. No changes needed — they already work correctly with the transferred state.

- [ ] **Step 6: Verify and commit**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -20`

Expected: No TypeScript errors related to requests-client.tsx.

```bash
git add src/app/\(admin\)/requests/requests-client.tsx
git commit -m "feat: redesigned admin requests as batched cards with status colors"
```

---

### Task 2: Improve Seller Cart Comment & Confirm Dialog

**Files:**
- Modify: `src/app/(seller)/low-stock/low-stock-client.tsx:140-240` (cart panel and confirm dialog sections)

Make the comment field more prominent in the cart, and improve the confirm dialog layout and comment visibility.

- [ ] **Step 1: Improve cart panel comment field**

Find the cart panel's notes input. Replace the existing notes section with a more prominent version:

Find:
```tsx
          <div className="space-y-2">
            <Input
              placeholder="Коментар (по желание)"
              value={cartNotes}
              onChange={e => setCartNotes(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
```

Replace with:
```tsx
          <div className="space-y-1.5 px-1">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Коментар към заявката (по желание)
            </p>
            <Input
              placeholder="Напр. Трябват за уикенда..."
              value={cartNotes}
              onChange={e => setCartNotes(e.target.value)}
              className="h-10 text-sm"
            />
          </div>
```

- [ ] **Step 2: Improve confirm dialog layout**

Find the confirm dialog's comment section. Replace with more prominent version:

Find:
```tsx
              <div className="space-y-2">
                <p className="text-sm font-medium">Коментар (по желание)</p>
                <Input
                  placeholder="Напр. липсват 2 броя"
                  value={confirmNotes}
                  onChange={e => setConfirmNotes(e.target.value)}
                />
              </div>
```

Replace with:
```tsx
              <div className="space-y-1.5">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  Коментар (по желание)
                </p>
                <Input
                  placeholder="Напр. липсват 2 броя, ще дойдат утре"
                  value={confirmNotes}
                  onChange={e => setConfirmNotes(e.target.value)}
                  className="h-10"
                />
              </div>
```

- [ ] **Step 3: Add MessageSquare import if missing**

Check `lucide-react` import in low-stock-client.tsx. If `MessageSquare` is not in the import list, add it:

Find: `import { AlertTriangle, Send, Search, ShoppingCart, X, Plus, Minus, Package, Check, Loader2 } from 'lucide-react'`

Add `MessageSquare`: `import { AlertTriangle, Send, Search, ShoppingCart, X, Plus, Minus, Package, Check, Loader2, MessageSquare } from 'lucide-react'`

- [ ] **Step 4: Verify and commit**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | grep "low-stock-client" | head -10`

Expected: No output (no errors in low-stock-client.tsx).

```bash
git add src/app/\(seller\)/low-stock/low-stock-client.tsx
git commit -m "feat: improved seller comment fields visibility in cart and confirm dialog"
```

---

### Task 3: Final Verification & Push

- [ ] **Step 1: TypeScript check**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | grep -E "error|Error" | wc -l`

Expected: 0 errors.

- [ ] **Step 2: Push to both remotes**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git push origin main
git push github main
```

- [ ] **Step 3: Verify Vercel deployment**

Check the Vercel dashboard or use `vercel list-deployments` to confirm the deployment succeeds with state READY.
