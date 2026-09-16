# WooCommerce Product Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a product be written in Prody, pushed to WooCommerce with one button, and updated in place on later pushes.

**Architecture:** Eight nullable columns on `products` carry the shop copy and the sync bookkeeping. A thin client in `src/lib/woocommerce.ts` wraps the REST API. One route pushes a single product, deciding create-vs-update from whether `wp_product_id` is already set. The product form gains a third tab; the catalogue gains a filter and a marker.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL), WooCommerce REST API v3, Tailwind + shadcn/ui.

## Global Constraints

- **Staging only. Production is never touched** — not its schema, not its data, not a migration, not a push. The staging project ref is `ruhhsixmqusnpiajkbxe`; the production ref `ocvmqlbfkloskabicxuw` must not appear in any migration, script or request made while executing this plan.
- No test framework exists in this project (no vitest/jest, no test files, scripts are only `dev`/`build`/`start`/`lint`). Every task is verified by running it against staging and observing real data. Do not introduce a test framework as part of this work.
- `npx tsc --noEmit` must pass before every commit. Ignore errors originating in `.next/dev/types/` — those are a stale Next.js cache, not real. Clear with `rm -rf .next/dev/types` if they appear.
- WooCommerce credentials live in environment variables only. Never in the repository, never in a commit, never printed to a log or a chat.
- The dev server runs on port 3000 and must stay on it (Supabase auth and `NEXT_PUBLIC_SITE_URL` are bound to it). Start it via the Browser pane's `preview_start` with the `prody` config, not a bare `npm run dev`.
- Existing code conventions: form fields wrap in `<div className="space-y-2">`, multi-line fields use `Textarea` from `@/components/ui/textarea`, tabs use `@/components/ui/tabs`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260915_wp_product_fields.sql` | Create: the eight columns |
| `src/lib/woocommerce.ts` | Create: REST client — auth, create, update, one product |
| `src/app/api/products/[id]/push-to-wp/route.ts` | Create: the push endpoint |
| `src/components/products/product-form.tsx` | Modify: third tab, six fields, copy-title button, payload |
| `src/lib/db/products.ts` | Modify: `notOnSite` filter |
| `src/components/products/product-search.tsx` | Modify: the filter's dropdown entry |
| `src/app/(admin)/catalog/page.tsx` | Modify: pass the filter through |
| `src/app/(admin)/catalog/[id]/page.tsx` | Modify: push button + sync marker |

`getProduct` needs no change — it selects `*`, so new columns arrive on their own.

---

### Task 1: The columns

**Files:**
- Create: `supabase/migrations/20260915_wp_product_fields.sql`

**Interfaces:**
- Produces: columns `wp_title`, `wp_description`, `wp_short_description`, `wp_ingredients`, `wp_usage`, `wp_warnings` (all `text`), `wp_product_id` (`bigint`), `wp_synced_at` (`timestamptz`) on `public.products`. Every later task reads or writes these names.

- [ ] **Step 1: Write the migration**

```sql
-- Shop copy and sync bookkeeping for WooCommerce.
--
-- Prody is the source of truth for products on the shop: a product is written
-- here, pushed once to create it, and pushed again to update the same record.
-- wp_product_id is what makes the second push an update instead of a duplicate.
--
-- Ingredients, usage and warnings are separate columns rather than one blob
-- because the shop displays them separately. Collapsing them later is easy;
-- splitting a combined column after it holds data is not.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wp_title             text,
  ADD COLUMN IF NOT EXISTS wp_description       text,
  ADD COLUMN IF NOT EXISTS wp_short_description text,
  ADD COLUMN IF NOT EXISTS wp_ingredients       text,
  ADD COLUMN IF NOT EXISTS wp_usage             text,
  ADD COLUMN IF NOT EXISTS wp_warnings          text,
  ADD COLUMN IF NOT EXISTS wp_product_id        bigint,
  ADD COLUMN IF NOT EXISTS wp_synced_at         timestamptz;

COMMENT ON COLUMN public.products.wp_product_id IS
  'WooCommerce product id. NULL means never pushed; set on the first successful push and used to update in place afterwards.';

COMMENT ON COLUMN public.products.wp_synced_at IS
  'Time of the last successful push. Written by the application only.';

-- A product maps to at most one shop record, and two Prody products must never
-- claim the same one — that would make each push overwrite the other.
CREATE UNIQUE INDEX IF NOT EXISTS products_wp_product_id_key
  ON public.products (wp_product_id)
  WHERE wp_product_id IS NOT NULL;
```

- [ ] **Step 2: Apply it to staging only**

Apply via the Supabase MCP `apply_migration` with `project_id: ruhhsixmqusnpiajkbxe`, name `wp_product_fields`.

**Do not apply this to production.** Confirm the project id reads `ruhhsixmqusnpiajkbxe` before running.

- [ ] **Step 3: Verify the columns landed and no data moved**

Run against staging:

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='products'
      and column_name like 'wp_%') as new_columns,
  (select count(*) from public.products) as products,
  (select count(*) from public.products where wp_product_id is not null) as already_synced;
```

Expected: `new_columns` = 8, `products` unchanged from before the migration, `already_synced` = 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260915_wp_product_fields.sql
git commit -m "feat: columns for WooCommerce product copy and sync state

Eight nullable columns carry the shop copy — title, both descriptions,
ingredients, usage, warnings — plus wp_product_id and wp_synced_at, which
are written by the application and are what turn a second push into an
update rather than a duplicate.

A partial unique index on wp_product_id stops two Prody products from
claiming the same shop record, which would make each push overwrite the
other.

Applied to staging only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The WooCommerce client

**Files:**
- Create: `src/lib/woocommerce.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type WooProductInput = { name: string; description?: string; short_description?: string; regular_price?: string; sku?: string; stock_quantity?: number; manage_stock?: boolean; meta_data?: { key: string; value: string }[] }`
  - `type WooProduct = { id: number; name: string; permalink: string }`
  - `createProduct(input: WooProductInput): Promise<WooProduct>`
  - `updateProduct(id: number, input: WooProductInput): Promise<WooProduct>`
  - `isWooConfigured(): boolean`
  - All three are imported by Task 3.

- [ ] **Step 1: Write the client**

```typescript
/**
 * Minimal WooCommerce REST API v3 client.
 *
 * Only what pushing a product needs: create, update, and a way to ask whether
 * the shop is configured at all. Credentials come from the environment and are
 * never logged — an error from here carries WooCommerce's own message, not the
 * request that produced it.
 */

const BASE = process.env.WOOCOMMERCE_URL
const KEY = process.env.WOOCOMMERCE_CONSUMER_KEY
const SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET

export type WooProductInput = {
  name: string
  description?: string
  short_description?: string
  regular_price?: string
  sku?: string
  stock_quantity?: number
  manage_stock?: boolean
  meta_data?: { key: string; value: string }[]
}

export type WooProduct = {
  id: number
  name: string
  permalink: string
}

export function isWooConfigured(): boolean {
  return Boolean(BASE && KEY && SECRET)
}

function authHeader(): string {
  // WooCommerce accepts basic auth over HTTPS; the key pair is the credential.
  return 'Basic ' + Buffer.from(`${KEY}:${SECRET}`).toString('base64')
}

async function request(path: string, method: 'POST' | 'PUT', body: unknown): Promise<WooProduct> {
  if (!isWooConfigured()) {
    throw new Error('WooCommerce не е настроен (липсват WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY или WOOCOMMERCE_CONSUMER_SECRET)')
  }

  const res = await fetch(`${BASE!.replace(/\/$/, '')}/wp-json/wc/v3${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })

  const text = await res.text()

  if (!res.ok) {
    // Surface WooCommerce's own message rather than a generic failure: the
    // difference between a bad credential and a rejected field matters to
    // whoever is looking at the screen.
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) detail = parsed.message
    } catch { /* keep the raw text */ }
    throw new Error(`WooCommerce отказа (${res.status}): ${detail}`)
  }

  return JSON.parse(text) as WooProduct
}

export async function createProduct(input: WooProductInput): Promise<WooProduct> {
  return request('/products', 'POST', input)
}

export async function updateProduct(id: number, input: WooProductInput): Promise<WooProduct> {
  return request(`/products/${id}`, 'PUT', input)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors outside `.next/dev/types/`.

- [ ] **Step 3: Verify the unconfigured path without credentials**

With no WooCommerce variables set, the client must refuse clearly rather than attempt a request to `undefined`. Confirm by reading the code path: `isWooConfigured()` returns false, and `request` throws the Bulgarian message before any `fetch`.

Do not set real credentials in this task. Task 5 covers the live call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/woocommerce.ts
git commit -m "feat: WooCommerce REST client

Create and update against the v3 API, plus isWooConfigured() so callers can
tell a missing configuration from a failed request.

Errors carry WooCommerce's own message: a rejected field and a bad
credential need different responses from whoever sees the screen, and a
generic failure hides which one happened. Credentials come from the
environment and never appear in a message or a log.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The push endpoint

**Files:**
- Create: `src/app/api/products/[id]/push-to-wp/route.ts`

**Interfaces:**
- Consumes: `createProduct`, `updateProduct`, `isWooConfigured`, `WooProductInput` from Task 2; the `wp_*` columns from Task 1.
- Produces: `POST /api/products/:id/push-to-wp` returning `{ success: true, wp_product_id: number, permalink: string, created: boolean }` on success, or `{ error: string }` with status 400/403/404/500. Task 6 calls it.

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createProduct, updateProduct, isWooConfigured, type WooProductInput } from '@/lib/woocommerce'
import { logAction } from '@/lib/audit'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isWooConfigured()) {
    return NextResponse.json(
      { error: 'WooCommerce не е настроен на този сървър' },
      { status: 400 },
    )
  }

  const { id } = await params
  const admin = createAdminClient()

  const { data: product } = await (admin.from('products') as any)
    .select('id, name, sku, price, wp_title, wp_description, wp_short_description, wp_ingredients, wp_usage, wp_warnings, wp_product_id')
    .eq('id', id)
    .single()

  if (!product) return NextResponse.json({ error: 'Продуктът не съществува' }, { status: 404 })

  // Shop and catalogue names are meant to differ, so there is no fallback to
  // product.name here: an empty wp_title means nobody decided what the shop
  // should call it, and publishing the internal name would hide that.
  const title = (product.wp_title || '').trim()
  if (!title) {
    return NextResponse.json(
      { error: 'Липсва заглавие за сайта — попълнете го в таб „За уебсайта"' },
      { status: 400 },
    )
  }

  // Stock comes from the batches, which a physical count confirmed is the
  // accurate side; products.quantity_on_hand drifted above them.
  const { data: batches } = await (admin.from('stock_batches') as any)
    .select('quantity_remaining')
    .eq('product_id', id)
    .gt('quantity_remaining', 0)

  const stock = (batches || []).reduce(
    (sum: number, b: any) => sum + (b.quantity_remaining || 0),
    0,
  )

  const meta: { key: string; value: string }[] = []
  if (product.wp_ingredients?.trim()) meta.push({ key: '_ingredients', value: product.wp_ingredients.trim() })
  if (product.wp_usage?.trim()) meta.push({ key: '_usage', value: product.wp_usage.trim() })
  if (product.wp_warnings?.trim()) meta.push({ key: '_warnings', value: product.wp_warnings.trim() })

  const payload: WooProductInput = {
    name: title,
    description: product.wp_description?.trim() || '',
    short_description: product.wp_short_description?.trim() || '',
    manage_stock: true,
    stock_quantity: stock,
    ...(product.price != null ? { regular_price: String(product.price) } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(meta.length > 0 ? { meta_data: meta } : {}),
  }

  try {
    const existingId: number | null = product.wp_product_id ?? null
    const result = existingId
      ? await updateProduct(existingId, payload)
      : await createProduct(payload)

    // Only recorded after WooCommerce confirms. A failed push leaves
    // wp_synced_at untouched, so the catalogue never claims a product is on
    // the shop when it is not.
    const { error: updErr } = await (admin.from('products') as any)
      .update({ wp_product_id: result.id, wp_synced_at: new Date().toISOString() })
      .eq('id', id)

    if (updErr) {
      return NextResponse.json(
        { error: `Продуктът е качен (id ${result.id}), но записът в Prody не мина: ${updErr.message}` },
        { status: 500 },
      )
    }

    await logAction({
      action: existingId ? 'wp_update' : 'wp_create',
      userId: user.id,
      entityType: 'product',
      entityId: id,
      details: `${title} → WooCommerce #${result.id}`,
    }, admin)

    return NextResponse.json({
      success: true,
      wp_product_id: result.id,
      permalink: result.permalink,
      created: !existingId,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Качването не мина' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors outside `.next/dev/types/`.

- [ ] **Step 3: Verify the validation path against staging**

Start the dev server (Browser pane, `preview_start` with the `prody` config). Log in as an admin.

Pick a staging product with no `wp_title`:

```sql
select id, name from public.products where wp_title is null limit 1;
```

From the browser console, with that id:

```javascript
fetch('/api/products/<id>/push-to-wp', { method: 'POST', credentials: 'same-origin' })
  .then(r => r.json().then(b => ({ status: r.status, body: b })))
```

Expected: status 400 and the message about a missing title — **not** a WooCommerce error, proving validation runs before the request leaves.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/products/[id]/push-to-wp/route.ts"
git commit -m "feat: push a product to WooCommerce

Creates the shop record on the first push and updates the same one
afterwards, keyed on wp_product_id.

wp_title is required rather than falling back to the catalogue name: the
two are meant to differ, so an empty one means nobody decided what the shop
should call the product, and publishing the internal name would bury that.
Validation runs before the request so a missing title never reaches
WooCommerce.

Stock is summed from stock_batches rather than products.quantity_on_hand —
a physical count established the batches are the accurate side.

wp_synced_at is written only after WooCommerce confirms, so a failed push
never leaves the catalogue claiming a product is on the shop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The form tab

**Files:**
- Modify: `src/components/products/product-form.tsx`

**Interfaces:**
- Consumes: the `wp_*` columns from Task 1 (read via `initialData`, written via the payload).
- Produces: nothing other tasks import.

- [ ] **Step 1: Add the six state hooks**

After the existing `labelContent` state (around line 77), add:

```typescript
  const [wpTitle, setWpTitle] = useState(initialData?.wp_title || '')
  const [wpShortDescription, setWpShortDescription] = useState(initialData?.wp_short_description || '')
  const [wpDescription, setWpDescription] = useState(initialData?.wp_description || '')
  const [wpIngredients, setWpIngredients] = useState(initialData?.wp_ingredients || '')
  const [wpUsage, setWpUsage] = useState(initialData?.wp_usage || '')
  const [wpWarnings, setWpWarnings] = useState(initialData?.wp_warnings || '')
```

`initialData` is typed loosely in this file; if TypeScript objects to the new properties, widen its type where it is declared rather than casting at each use.

- [ ] **Step 2: Add the tab trigger**

In the `TabsList` (around line 317), after the Етикет trigger:

```tsx
          <TabsTrigger value="website">За уебсайта</TabsTrigger>
```

- [ ] **Step 3: Add the tab content**

After the closing tag of the `label` TabsContent, add:

```tsx
        <TabsContent value="website" className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Тези полета отиват в сайта при качване. Празните се пропускат.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="wp_title" className="text-sm font-medium">
                Заглавие за сайта
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setWpTitle(name)}
                disabled={!name.trim()}
              >
                Копирай от Prody
              </Button>
            </div>
            <Input
              id="wp_title"
              value={wpTitle}
              onChange={e => setWpTitle(e.target.value)}
              placeholder="Както да се казва продуктът в сайта"
            />
            <p className="text-xs text-muted-foreground">
              Задължително за качване. Може да се различава от името в Prody.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="wp_short_description" className="text-sm font-medium">
              Кратко описание
            </label>
            <Textarea
              id="wp_short_description"
              rows={3}
              value={wpShortDescription}
              onChange={e => setWpShortDescription(e.target.value)}
              placeholder="Показва се до бутона за поръчка"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="wp_description" className="text-sm font-medium">
              Пълно описание
            </label>
            <Textarea
              id="wp_description"
              rows={6}
              value={wpDescription}
              onChange={e => setWpDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="wp_ingredients" className="text-sm font-medium">
              Състав
            </label>
            <Textarea
              id="wp_ingredients"
              rows={4}
              value={wpIngredients}
              onChange={e => setWpIngredients(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="wp_usage" className="text-sm font-medium">
              Начин на употреба
            </label>
            <Textarea
              id="wp_usage"
              rows={3}
              value={wpUsage}
              onChange={e => setWpUsage(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="wp_warnings" className="text-sm font-medium">
              Предупреждения
            </label>
            <Textarea
              id="wp_warnings"
              rows={3}
              value={wpWarnings}
              onChange={e => setWpWarnings(e.target.value)}
            />
          </div>
        </TabsContent>
```

- [ ] **Step 4: Add the fields to the save payload**

In the payload object (around line 145, beside `min_quantity`), add:

```typescript
        wp_title: wpTitle.trim() || null,
        wp_short_description: wpShortDescription.trim() || null,
        wp_description: wpDescription.trim() || null,
        wp_ingredients: wpIngredients.trim() || null,
        wp_usage: wpUsage.trim() || null,
        wp_warnings: wpWarnings.trim() || null,
```

`wp_product_id` and `wp_synced_at` are deliberately absent — they belong to the push route, and writing them here would let the form claim a product is on the shop.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors outside `.next/dev/types/`.

- [ ] **Step 6: Verify against staging**

With the dev server running and logged in as admin:

1. Open any product for editing. The third tab **За уебсайта** is present.
2. Click **Копирай от Prody** — the title field fills with the catalogue name.
3. Change it, fill in Състав, save.
4. Confirm it persisted:

```sql
select name, wp_title, wp_ingredients from public.products
where wp_title is not null order by updated_at desc limit 1;
```

Expected: the row shows the edited title and the ingredients text.

- [ ] **Step 7: Commit**

```bash
git add src/components/products/product-form.tsx
git commit -m "feat: За уебсайта tab on the product form

Six fields for the shop copy, in a third tab so products that never reach
the shop are unaffected.

The title has a Копирай от Prody button rather than defaulting to the
catalogue name. The two are meant to differ, and leaving it an explicit
action keeps an empty title meaningful: it means nobody has decided yet,
which is what the push endpoint refuses on.

wp_product_id and wp_synced_at are not in the payload — they belong to the
push route, and writing them here would let the form claim a product is on
the shop when it is not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The catalogue filter and marker

**Files:**
- Modify: `src/lib/db/products.ts`
- Modify: `src/components/products/product-search.tsx`
- Modify: `src/app/(admin)/catalog/page.tsx`

**Interfaces:**
- Consumes: `wp_product_id` from Task 1.
- Produces: the query-string parameter `wp=not_synced`, read by the catalogue page.

- [ ] **Step 1: Add the filter to the query builder**

In `src/lib/db/products.ts`, add `wp?: string` to the `getProducts` filters type, then after the `categoryId` block:

```typescript
  // 'not_synced' asks for the products that have never reached the shop. As
  // with the category filter, a plain falsy check cannot express it, since an
  // empty value already means 'do not filter'.
  if (filters?.wp === 'not_synced') {
    query = query.is('wp_product_id', null)
  }
```

- [ ] **Step 2: Add the dropdown entry**

In `src/components/products/product-search.tsx`, mirroring how the category select is wired: add a `wp` state initialised from `searchParams.get('wp') || 'all'`, include `wp` in the `updateParams` signature and in the params it writes (`if (w && w !== 'all') params.set('wp', w)`), and add the select:

```tsx
      <Select value={wp} onValueChange={(v) => { setWp(v); updateParams({ wp: v }) }}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Сайт" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Всички</SelectItem>
          <SelectItem value="not_synced">Не е в сайта</SelectItem>
        </SelectContent>
      </Select>
```

- [ ] **Step 3: Pass it through the page**

In `src/app/(admin)/catalog/page.tsx`, add `wp?: string` to the `searchParams` type, pass `wp: params.wp` into the `getProducts` call, and include it in the `filterParams` object alongside `category` so it survives pagination.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors outside `.next/dev/types/`.

- [ ] **Step 5: Verify the count matches the database**

With the dev server running, open `/catalog?wp=not_synced` and count the products shown. Compare against:

```sql
select count(*) from public.products
where wp_product_id is null and status='active';
```

Expected: the page and the query agree. Before any push has happened this is every active product, which is the correct starting state.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/products.ts src/components/products/product-search.tsx "src/app/(admin)/catalog/page.tsx"
git commit -m "feat: filter the catalogue for products not yet on the shop

wp=not_synced maps to wp_product_id IS NULL, the same shape as the
uncategorised filter: an empty value already means 'do not filter', so the
state needs its own sentinel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The push button

**Files:**
- Create: `src/components/products/push-to-wp-button.tsx`
- Modify: `src/app/(admin)/catalog/[id]/page.tsx`

**Interfaces:**
- Consumes: the endpoint from Task 3; `wp_title`, `wp_product_id`, `wp_synced_at` from Task 1.
- Produces: `<PushToWpButton productId wpTitle wpProductId wpSyncedAt />`.

- [ ] **Step 1: Write the button**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Globe } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useRouter } from 'next/navigation'

type Props = {
  productId: string
  wpTitle: string | null
  wpProductId: number | null
  wpSyncedAt: string | null
}

export function PushToWpButton({ productId, wpTitle, wpProductId, wpSyncedAt }: Props) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const hasTitle = Boolean(wpTitle?.trim())

  const push = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/products/${productId}/push-to-wp`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const body = await res.json().catch(() => ({}))

      if (res.ok) {
        toast({
          title: body.created ? 'Продуктът е качен в сайта' : 'Продуктът е обновен в сайта',
          description: body.permalink,
        })
        router.refresh()
      } else {
        toast({
          title: 'Качването не мина',
          description: body.error || `Грешка ${res.status}`,
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Няма връзка със сървъра', variant: 'destructive' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" onClick={push} disabled={busy || !hasTitle}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
        {wpProductId ? 'Обнови в сайта' : 'Изпрати към сайта'}
      </Button>
      {!hasTitle && (
        <p className="text-xs text-muted-foreground">
          Липсва заглавие за сайта — попълнете го в таб „За уебсайта“
        </p>
      )}
      {wpSyncedAt && (
        <p className="text-xs text-muted-foreground">
          В сайта от {new Date(wpSyncedAt).toLocaleDateString('bg-BG')}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Place it on the product page**

In `src/app/(admin)/catalog/[id]/page.tsx`, import the component and render it beside the existing Печат / Редакция buttons:

```tsx
<PushToWpButton
  productId={product.id}
  wpTitle={(product as any).wp_title ?? null}
  wpProductId={(product as any).wp_product_id ?? null}
  wpSyncedAt={(product as any).wp_synced_at ?? null}
/>
```

`getProduct` selects `*`, so these arrive without a query change.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors outside `.next/dev/types/`.

- [ ] **Step 4: Verify the disabled state against staging**

Open a product with no `wp_title`. Expected: the button is disabled and the line about the missing title is shown. Nothing is sent.

Then fill in a title via the form, return to the product, and confirm the button becomes enabled and reads **Изпрати към сайта**.

- [ ] **Step 5: Commit**

```bash
git add src/components/products/push-to-wp-button.tsx "src/app/(admin)/catalog/[id]/page.tsx"
git commit -m "feat: push button on the product page

Disabled with the reason shown when the shop title is missing, rather than
failing on click. Reads Изпрати към сайта before the first push and Обнови
в сайта after, and shows the date it last reached the shop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Live verification against the real shop

This task is the only one that talks to WooCommerce. It still touches no
production Prody data — the product records it reads and updates are staging's.

**Files:** none changed unless a mismatch is found.

- [ ] **Step 1: Observe one real product's shape**

Before pushing anything, fetch a single existing product from the shop with a
**read-only** key and record the field names actually returned. WooCommerce
field shapes vary between versions, and the payload in Task 3 is written
against the v3 documentation rather than this specific shop.

If `meta_data`, `short_description`, `regular_price` or `stock_quantity` differ
from what Task 3 sends, correct `src/lib/woocommerce.ts` and Task 3's payload
before continuing, and commit that correction.

- [ ] **Step 2: Configure credentials locally**

Add to `.env.local` — never to the repository:

```
WOOCOMMERCE_URL=https://<the shop>
WOOCOMMERCE_CONSUMER_KEY=<key>
WOOCOMMERCE_CONSUMER_SECRET=<secret>
```

Restart the dev server so Next reads them.

- [ ] **Step 3: Push one product and confirm it created**

Pick a single staging product, fill in its shop fields, push it.

Expected: success toast with a permalink; the shop shows the product with the
title, descriptions and stock that were sent.

Confirm the bookkeeping:

```sql
select name, wp_title, wp_product_id, wp_synced_at
from public.products where wp_product_id is not null;
```

Expected: exactly one row, with an id and a timestamp.

- [ ] **Step 4: Push the same product again and confirm it updated**

Change the shop title, push again.

Expected: the toast reads **обновен**, the shop shows the new title, and the
query above still returns **one** row with the **same** `wp_product_id`. A
second row or a changed id means the update path is creating duplicates.

- [ ] **Step 5: Confirm the theme renders the custom fields**

Open the pushed product on the shop and look for the ingredients text.

WooCommerce stores `_ingredients`, `_usage` and `_warnings` but does not
display them — the theme must read them. If they are absent from the page,
the data is saved correctly and the remaining work is in the theme, which is
outside this plan. Record which of the three appear.

- [ ] **Step 6: Delete the test product from the shop**

Remove the product created in Step 3 from WooCommerce, and clear its
bookkeeping in staging:

```sql
update public.products set wp_product_id = null, wp_synced_at = null
where wp_product_id is not null;
```

- [ ] **Step 7: Commit any corrections from Step 1**

If the observed field shapes required changes:

```bash
git add src/lib/woocommerce.ts "src/app/api/products/[id]/push-to-wp/route.ts"
git commit -m "fix: match the payload to the shop's actual API shape

Observed from a real request/response pair rather than the v3 docs alone —
field names vary between WooCommerce versions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If nothing needed changing, skip this step.

---

### Task 8: Carry the filters through infinite scroll

Added after Task 5. The catalogue loads 50 products server-side and fetches the
rest through `/api/products/load-more` as the user scrolls. That route reads
six query parameters — `search`, `status`, `sort`, `category`, `store`,
`limit`/`offset` — and neither `wp` nor `hasImages` is among them, so both
filters stop applying from row 51 onwards.

`hasImages` additionally never leaves the page: `catalog/page.tsx` builds
`filterParams` without it, so the grid has nothing to forward even once the
route accepts it. Both halves must be fixed for either filter to survive.

`hasImages` is a pre-existing gap, not one this branch introduced. It is
included because it is the same defect in the same two files, and splitting it
into its own task would mean touching both files twice.

**Files:**
- Modify: `src/app/api/products/load-more/route.ts` — read both parameters and pass them to `getProducts`
- Modify: `src/components/products/catalog-infinite-grid.tsx` — forward both to the route
- Modify: `src/app/(admin)/catalog/page.tsx:55-61` — put `hasImages` into `filterParams`

**Interfaces:**
- Consumes: `getProducts({ wp, hasImages, ... })` from `src/lib/db/products.ts` — both already accepted, both already implemented (`wp` at line 33, `hasImages` at line 65)
- Produces: nothing new; no signature changes

Note on `hasImages`: `getProducts` applies it **after** the query returns, as a
filter on the 50-row page rather than a condition in SQL. A page can therefore
come back with fewer than `limit` rows while more still exist, which makes
`hasMore: products.length >= limit` end the scroll early. That behaviour is
pre-existing and **out of scope here** — this task carries the parameter
through; it does not move the filter into SQL. Do not attempt that change.

- [ ] **Step 1: Read the three files**

Read them before editing. The route and the grid each list their parameters in
one place; add to those lists rather than restructuring.

- [ ] **Step 2: Accept both parameters in the route**

In `src/app/api/products/load-more/route.ts`, alongside the existing
`const store = ...` line:

```typescript
  const hasImages = searchParams.get('hasImages') || undefined
  const wp = searchParams.get('wp') || undefined
```

and pass them into the existing `getProducts({ ... })` call:

```typescript
  const products = await getProducts({
    search, status, sort, hasImages, wp,
    categoryId: category,
    storeId: store,
    limit, offset,
  })
```

- [ ] **Step 3: Forward both from the grid**

In `src/components/products/catalog-infinite-grid.tsx`, after the existing
`if (f.store) params.set('store', f.store)`:

```typescript
        if (f.hasImages) params.set('hasImages', f.hasImages)
        if (f.wp) params.set('wp', f.wp)
```

- [ ] **Step 4: Put hasImages into filterParams**

In `src/app/(admin)/catalog/page.tsx`, after the `params.store` line and before
the `params.wp` line:

```typescript
  if (params.hasImages) filterParams.hasImages = params.hasImages
```

`params.hasImages` is already in the `PageProps` type at line 19 and already
reaches `getProducts` at line 27 — only `filterParams` was missing it.

- [ ] **Step 5: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: exit 0, no new errors.

- [ ] **Step 6: Verify live against staging**

The dev server runs on port 3000 against staging. With an authenticated
session, request the load-more route directly with a filter that
discriminates, and confirm the response honours it:

```
/api/products/load-more?wp=not_synced&limit=5&offset=0
```

Expected: 5 products, every one of them with `wp_product_id` null.

Then the negative control — without the parameter, the same offset should be
free to return synced products too. With staging currently at 0 synced
products this control cannot discriminate, so note it as such rather than
claiming it passed. Record in the report exactly which of the two checks
actually discriminated.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/products/load-more/route.ts src/components/products/catalog-infinite-grid.tsx "src/app/(admin)/catalog/page.tsx"
git commit -m "fix: carry the catalogue filters through infinite scroll

load-more read neither wp nor hasImages, so both filters stopped applying
from row 51. hasImages never left the page either. Both halves fixed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Write the fields the shop actually reads

Added after observing three real shop products. The spec's theme dependency —
"the theme must be checked to confirm it displays `_ingredients`, `_usage` and
`_warnings`, or they will be saved and invisible" — was checked against the
live shop and **failed**. The theme is Woodmart, and it reads its own meta keys.
Nothing on zonapharm.com reads `_ingredients`, `_usage` or `_warnings`.

Observed on products 203794, 200403 and 203519 — all three identical in shape:

| Woodmart key | Holds |
|---|---|
| `_woodmart_product_custom_tab_title` | tab 1 title, always "Състав" |
| `_woodmart_product_custom_tab_content` | tab 1 body |
| `_woodmart_product_custom_tab_content_type` | always `text` |
| `_woodmart_product_custom_tab_title_2` | tab 2 title ("Указания за употреба" ×2, "Указания" ×1) |
| `_woodmart_product_custom_tab_content_2` | tab 2 body |
| `_woodmart_product_custom_tab_content_type_2` | always `text` |

`content_type` is `text` yet the stored values contain HTML (`<ul>`, `<li>`,
`<em>`) and the shop renders it. So these fields accept HTML.

There is no third custom tab. The "Противопоказания" tab visible on product
pages is global theme text, identical for every product and not settable per
product — which is why warnings must join tab 2.

**User decisions driving this task** (do not revisit them):
- Warnings append to the usage tab, separated by a blank line — matching what
  product 203519 already does by hand.
- Tab 2's title is per-product, not hardcoded, because the shop is inconsistent
  about it. Default "Указания за употреба".
- Categories are chosen per product from the shop's own list. Prody's own
  categories are suppliers/brands (Арома, Витамаг, Зонафарм…) while the shop's
  are health concerns (Женско здраве, За кожата…) — the two do not map, so
  nothing is derived automatically.
- Multiple categories per product are allowed; product 203519 has two.
- **Stock is no longer sent.** All three observed products have
  `manage_stock: false`. The current code forces `manage_stock: true` with a
  batch total, which made the test product display "1 налични". Sending stock
  is contrary to how this shop is run.

**Files:**
- Create: `supabase/migrations/20260916_wp_woodmart_fields.sql`
- Modify: `src/app/api/products/[id]/push-to-wp/route.ts:61-75`
- Modify: `src/components/products/product-form.tsx`
- Create: `src/app/api/woocommerce/categories/route.ts`

**Interfaces:**
- Consumes: `isWooConfigured` from `src/lib/woocommerce.ts`
- Produces: `WooProductInput` gains `categories?: { id: number }[]` — add the
  field to the type in `src/lib/woocommerce.ts`

- [ ] **Step 1: Add the two new columns**

Create `supabase/migrations/20260916_wp_woodmart_fields.sql`:

```sql
-- The shop's theme (Woodmart) renders two per-product tabs whose titles are
-- editable, and its categories are health concerns rather than Prody's
-- suppliers. Both are therefore per-product choices, not derivable.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wp_usage_tab_title text,
  ADD COLUMN IF NOT EXISTS wp_category_ids    integer[];

COMMENT ON COLUMN public.products.wp_usage_tab_title IS
  'Title of the shop''s second product tab. NULL means use the default "Указания за употреба"; the shop is inconsistent about this wording, so it is editable per product.';

COMMENT ON COLUMN public.products.wp_category_ids IS
  'WooCommerce product category ids. Prody categories are suppliers and the shop''s are health concerns, so this is chosen per product, never derived.';
```

Do NOT apply this migration. The controller applies it to staging
(`ruhhsixmqusnpiajkbxe`). Never to production.

- [ ] **Step 2: Add categories to the client type**

In `src/lib/woocommerce.ts`, add one field to `WooProductInput`:

```typescript
  categories?: { id: number }[]
```

- [ ] **Step 3: Serve the shop's category list**

Create `src/app/api/woocommerce/categories/route.ts`. Admin-gated like the push
route, so copy its auth block verbatim (lines 11-19 of
`src/app/api/products/[id]/push-to-wp/route.ts`), then:

```typescript
  if (!isWooConfigured()) {
    return NextResponse.json({ error: 'WooCommerce не е настроен на този сървър' }, { status: 400 })
  }

  const base = process.env.WOOCOMMERCE_URL!.replace(/\/$/, '')
  const auth = 'Basic ' + Buffer.from(
    `${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`,
  ).toString('base64')

  const res = await fetch(
    `${base}/wp-json/wc/v3/products/categories?per_page=100&orderby=name&order=asc&_fields=id,name`,
    { headers: { Authorization: auth }, signal: AbortSignal.timeout(20000) },
  )

  if (!res.ok) {
    return NextResponse.json({ error: `WooCommerce отказа (${res.status})` }, { status: 502 })
  }

  return NextResponse.json({ categories: await res.json() })
```

The shop has 15 categories, so one page of 100 covers it with room to spare.
Never log or return the credentials.

- [ ] **Step 4: Build the Woodmart payload**

In `src/app/api/products/[id]/push-to-wp/route.ts`, add the two new columns to
the `.select(...)` on line 32:

```typescript
    .select('id, name, sku, price, wp_title, wp_description, wp_short_description, wp_ingredients, wp_usage, wp_warnings, wp_usage_tab_title, wp_category_ids, wp_product_id')
```

Replace lines 49-75 (the stock block, the `meta` block and the `payload`)
entirely with:

```typescript
  // Stock is deliberately not sent: every product on this shop runs with
  // manage_stock false, and pushing a quantity made a test product advertise
  // "1 налични". Prody remains the stock system; the shop does not track it.

  const ingredients = product.wp_ingredients?.trim() || ''
  const usage = product.wp_usage?.trim() || ''
  const warnings = product.wp_warnings?.trim() || ''

  // Warnings join the usage tab because the theme offers only two per-product
  // tabs; its "Противопоказания" tab is global text, identical for every
  // product. A blank line between them matches how the shop's own products
  // are written by hand.
  const usageTab = [usage, warnings].filter(Boolean).join('\n\n')

  const meta: { key: string; value: string }[] = []
  if (ingredients) {
    meta.push({ key: '_woodmart_product_custom_tab_title', value: 'Състав' })
    meta.push({ key: '_woodmart_product_custom_tab_content', value: ingredients })
    meta.push({ key: '_woodmart_product_custom_tab_content_type', value: 'text' })
  }
  if (usageTab) {
    meta.push({
      key: '_woodmart_product_custom_tab_title_2',
      value: product.wp_usage_tab_title?.trim() || 'Указания за употреба',
    })
    meta.push({ key: '_woodmart_product_custom_tab_content_2', value: usageTab })
    meta.push({ key: '_woodmart_product_custom_tab_content_type_2', value: 'text' })
  }

  const categoryIds: number[] = Array.isArray(product.wp_category_ids)
    ? product.wp_category_ids.filter((n: unknown) => typeof n === 'number')
    : []

  const payload: WooProductInput = {
    name: title,
    description: product.wp_description?.trim() || '',
    short_description: product.wp_short_description?.trim() || '',
    ...(product.price != null ? { regular_price: String(product.price) } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(categoryIds.length > 0 ? { categories: categoryIds.map(id => ({ id })) } : {}),
    ...(meta.length > 0 ? { meta_data: meta } : {}),
  }
```

Note what this removes: the `stock_batches` query, `manage_stock` and
`stock_quantity`. Leave the rest of the route — auth, the title check, the
create/update branch, the bookkeeping write, the audit log — untouched.

- [ ] **Step 5: Add the two controls to the form**

In `src/components/products/product-form.tsx`, inside the existing
`value="website"` tab, following the patterns already in that file:

Add state beside the existing `wp*` state:

```typescript
  const [wpUsageTabTitle, setWpUsageTabTitle] = useState(product?.wp_usage_tab_title || '')
  const [wpCategoryIds, setWpCategoryIds] = useState<number[]>(product?.wp_category_ids || [])
  const [wooCategories, setWooCategories] = useState<{ id: number; name: string }[]>([])
```

Load the list once when the component mounts:

```typescript
  useEffect(() => {
    fetch('/api/woocommerce/categories')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.categories) setWooCategories(d.categories) })
      .catch(() => { /* the shop may be unreachable; the rest of the form still works */ })
  }, [])
```

Render the tab-title input directly after the existing usage field, labelled
`Заглавие на таба с указания`, with placeholder `Указания за употреба`, bound
to `wpUsageTabTitle`.

Render the categories as a checkbox list labelled `Категории в сайта`, one row
per entry in `wooCategories`, checked when `wpCategoryIds` includes that id,
toggling the id in and out of `wpCategoryIds`. A checkbox list, not a
`<select multiple>` — the shop has 15 categories and a product may need
several. When `wooCategories` is empty, render the help text
`Списъкът не можа да се зареди` instead of an empty box.

Add both to the payload the form submits, alongside the existing `wp_*` fields:

```typescript
      wp_usage_tab_title: wpUsageTabTitle.trim() || null,
      wp_category_ids: wpCategoryIds.length > 0 ? wpCategoryIds : null,
```

As with the existing fields, the form must NOT send `wp_product_id` or
`wp_synced_at` — those belong to the push route alone.

- [ ] **Step 6: Verify the types compile**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260916_wp_woodmart_fields.sql src/lib/woocommerce.ts "src/app/api/products/[id]/push-to-wp/route.ts" src/app/api/woocommerce/categories/route.ts src/components/products/product-form.tsx
git commit -m "fix: write the meta keys the shop's theme actually reads

_ingredients/_usage/_warnings are read by nothing on zonapharm.com. The
Woodmart theme renders two per-product tabs from its own keys; warnings join
the usage tab because there is no third. Categories are now chosen per product
from the shop's list, and stock is no longer sent — the shop runs with
manage_stock false.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Out of scope

Stated so nobody adds them mid-implementation: images, SEO fields (meta title,
meta description, slug), WooCommerce categories and tags, attributes, related
products, bulk push of many products at once, and any sync from WooCommerce
back into Prody.

## Deployment

Nothing in this plan is deployed. `main` auto-deploys to production, so every
task commits to a branch and stays there. Deployment is a separate decision the
user makes after seeing the feature work, and it carries a prerequisite: the
migration in Task 1 must be applied to production **before** the code reaches
it, or every push will fail writing to columns that do not exist.
