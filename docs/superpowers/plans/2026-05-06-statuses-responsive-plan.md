# Status System & Responsive Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify product statuses to Active/Inactive + make all layouts responsive with header, collapsible sidebar, and adaptive grids.

**Architecture:** DB migration maps 5 statuses → 2. New Header component added to both layouts. Sidebar becomes overlay on mobile via Sheet pattern. POS stacks vertically on tablet. All grids use responsive column counts.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, Supabase SSR, Radix UI (Dialog, Select), Tailwind, lucide-react

---

### Task 1: Database Migration — Status Simplification

**Files:**
- Create: `supabase/migrations/00006_simplify_statuses.sql`

- [ ] **Step 1: Create migration**

```sql
-- Add inactive_reason column
ALTER TABLE products ADD COLUMN IF NOT EXISTS inactive_reason text;

-- Migrate existing data
UPDATE products SET status = 'active' WHERE status = 'listed';
UPDATE products SET status = 'inactive', inactive_reason = status WHERE status != 'active' AND status != 'inactive';

-- Note: remaining products with old status values get set to inactive
UPDATE products SET status = 'inactive' WHERE status NOT IN ('active', 'inactive');

-- Update check constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN ('active', 'inactive'));

-- Update RLS
DROP POLICY IF EXISTS "Sellers read listed products" ON products;
CREATE POLICY "Sellers read active products" ON products
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "Sellers read images of listed" ON product_images;
CREATE POLICY "Sellers read images of active" ON product_images
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM products p WHERE p.id = product_images.product_id AND p.status = 'active'
  ));

-- Update products RLS for admin (keep existing full access)
-- Admins full access products policy unchanged
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use Supabase MCP apply_migration for project `ocvmqlbfkloskabicxuw`.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add supabase/migrations/00006_simplify_statuses.sql
git commit -m "feat: simplify product statuses to active/inactive"
```

---

### Task 2: Update Constants

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Replace STATUS_LABELS and STATUS_VARIANTS**

Read the current file, then replace:

```typescript
export const STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  inactive: 'Неактивен',
}

export const STATUS_VARIANTS: Record<string, string> = {
  active: 'success',
  inactive: 'secondary',
}

export const INACTIVE_REASON_LABELS: Record<string, string> = {
  ordered: 'Поръчан',
  received: 'Получен',
  damaged: 'Повреден',
  returned: 'Върнат',
}
```

Note: `STATUS_VARIANTS` type changes from `Record<string, BadgeVariant>` to `Record<string, string>` since we're using custom colors. The Badge component may need custom CSS classes instead of the built-in variants.

Actually, let's keep using Tailwind classes directly in the badge. Update the type:

```typescript
export const STATUS_VARIANTS: Record<string, { bg: string; text: string; border: string }> = {
  active: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  inactive: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200' },
}

export const INACTIVE_REASON_LABELS: Record<string, string> = {
  ordered: 'Поръчан',
  received: 'Получен',
  damaged: 'Повреден',
  returned: 'Върнат',
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/lib/constants.ts
git commit -m "feat: simplify status labels to active/inactive with color objects"
```

---

### Task 3: Header Component

**Files:**
- Create: `src/components/ui/header.tsx`

- [ ] **Step 1: Create Header component**

```typescript
// src/components/ui/header.tsx

'use client'

import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SwitchRoleButton } from '@/components/admin/switch-role-button'

interface HeaderProps {
  title?: string
  showRoleSwitch?: boolean
  onMenuClick?: () => void
}

export function Header({ title, showRoleSwitch, onMenuClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-white px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden -ml-2"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Меню</span>
      </Button>

      <span className="font-bold text-lg tracking-tight">Prody</span>

      {title && (
        <span className="text-sm text-muted-foreground hidden sm:block">/ {title}</span>
      )}

      <div className="flex-1" />

      {showRoleSwitch && <SwitchRoleButton />}
    </header>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/ui/header.tsx
git commit -m "feat: add shared Header component with hamburger menu"
```

---

### Task 4: Responsive Admin Layout

**Files:**
- Modify: `src/app/(admin)/layout.tsx`

- [ ] **Step 1: Rewrite admin layout with responsive sidebar and header**

```typescript
// src/app/(admin)/layout.tsx

import { requireAdmin } from '@/lib/auth'
import Link from 'next/link'
import { Package2, BarChart3, ShoppingBag, Settings, LayoutDashboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/catalog', label: 'Каталог', icon: Package2 },
  { href: '/sales', label: 'Продажби', icon: ShoppingBag },
  { href: '/reports', label: 'Отчети', icon: BarChart3 },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <AdminLayoutClient navItems={navItems}>
      {children}
    </AdminLayoutClient>
  )
}
```

- [ ] **Step 2: Create AdminLayoutClient**

```typescript
// src/app/(admin)/layout-client.tsx

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/ui/header'
import { X } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export function AdminLayoutClient({
  navItems,
  children,
}: {
  navItems: NavItem[]
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const currentTitle = navItems.find(item => pathname.startsWith(item.href))?.label

  return (
    <div className="flex min-h-screen flex-col">
      <Header title={currentTitle} showRoleSwitch onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-56 flex-col border-r bg-slate-900 text-white shrink-0">
          <SidebarContent navItems={navItems} pathname={pathname} />
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-64 bg-slate-900 text-white flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <span className="font-bold text-lg">Prody</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <SidebarContent navItems={navItems} pathname={pathname} />
            </aside>
          </div>
        )}

        <main className="flex-1 bg-slate-50 p-4 lg:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({
  navItems,
  pathname,
}: {
  navItems: NavItem[]
  pathname: string
}) {
  return (
    <>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => (
          <Button
            key={item.href}
            variant={pathname.startsWith(item.href) ? 'secondary' : 'ghost'}
            asChild
            className={`w-full justify-start ${
              pathname.startsWith(item.href)
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Link href={item.href}>
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </Link>
          </Button>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <form action="/auth/signout" method="post">
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-400 hover:text-white"
          >
            Изход
          </Button>
        </form>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(admin\)/layout.tsx src/app/\(admin\)/layout-client.tsx
git commit -m "feat: responsive admin layout with header and mobile sidebar"
```

---

### Task 5: Responsive Seller Layout

**Files:**
- Modify: `src/app/(seller)/layout.tsx`
- Create: `src/app/(seller)/layout-client.tsx`

- [ ] **Step 1: Rewrite seller layout (server)**

```typescript
// src/app/(seller)/layout.tsx

import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { ShoppingBag, BarChart3 } from 'lucide-react'
import { SellerLayoutClient } from './layout-client'

export const dynamic = 'force-dynamic'

const navItems = [
  { href: '/record-sale', label: 'Запиши продажба', icon: ShoppingBag },
  { href: '/my-sales', label: 'Моите продажби', icon: BarChart3 },
]

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)

  return (
    <SellerLayoutClient
      navItems={navItems}
      displayName={user.display_name}
      isAdminImpersonating={user.role === 'admin' && effectiveRole === 'seller'}
    >
      {children}
    </SellerLayoutClient>
  )
}
```

- [ ] **Step 2: Create SellerLayoutClient**

```typescript
// src/app/(seller)/layout-client.tsx

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/ui/header'
import { RoleBanner } from '@/components/seller/role-banner'
import { X } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export function SellerLayoutClient({
  navItems,
  displayName,
  isAdminImpersonating,
  children,
}: {
  navItems: NavItem[]
  displayName: string
  isAdminImpersonating: boolean
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const currentTitle = navItems.find(item => pathname.startsWith(item.href))?.label

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        title={currentTitle}
        showRoleSwitch={isAdminImpersonating}
        onMenuClick={() => setSidebarOpen(true)}
      />

      {isAdminImpersonating && <RoleBanner />}

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-56 flex-col border-r bg-slate-900 text-white shrink-0">
          <SidebarContent navItems={navItems} pathname={pathname} displayName={displayName} />
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-full w-64 bg-slate-900 text-white flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-slate-800">
                <div>
                  <span className="font-bold text-lg">Prody</span>
                  <p className="text-xs text-slate-400">{displayName}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-slate-400"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <SidebarContent navItems={navItems} pathname={pathname} displayName={displayName} />
            </aside>
          </div>
        )}

        <main className="flex-1 bg-slate-50 p-4 lg:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function SidebarContent({
  navItems,
  pathname,
  displayName,
}: {
  navItems: NavItem[]
  pathname: string
  displayName: string
}) {
  return (
    <>
      {/* Display name only shown on desktop */}
      <div className="hidden lg:block p-4 border-b border-slate-800">
        <p className="text-xs text-slate-400">{displayName}</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => (
          <Button
            key={item.href}
            variant={pathname.startsWith(item.href) ? 'secondary' : 'ghost'}
            asChild
            className={`w-full justify-start ${
              pathname.startsWith(item.href)
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Link href={item.href}>
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </Link>
          </Button>
        ))}
      </nav>
      <div className="p-4 border-t border-slate-800">
        <form action="/auth/signout" method="post">
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-400 hover:text-white"
          >
            Изход
          </Button>
        </form>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(seller\)/layout.tsx src/app/\(seller\)/layout-client.tsx
git commit -m "feat: responsive seller layout with header and mobile sidebar"
```

---

### Task 6: Update ProductCard for New Statuses

**Files:**
- Modify: `src/components/products/product-card.tsx`

- [ ] **Step 1: Update badge rendering**

```typescript
// In ProductCard, replace variant logic:

import { STATUS_LABELS, STATUS_VARIANTS, INACTIVE_REASON_LABELS } from '@/lib/constants'

// Inside component:
const statusColors = STATUS_VARIANTS[product.status] || STATUS_VARIANTS.inactive
const statusLabel = STATUS_LABELS[product.status] || product.status
const inactiveReason = (product as any).inactive_reason
```

Replace the badge JSX:
```tsx
<Badge variant="secondary" className={`shrink-0 text-[10px] ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}>
  {statusLabel}
</Badge>
```

If `inactive` and has reason, show reason as tooltip:
```tsx
{product.status === 'inactive' && inactiveReason && (
  <span className="text-[10px] text-muted-foreground">
    · {INACTIVE_REASON_LABELS[inactiveReason] || inactiveReason}
  </span>
)}
```

Full updated return:
```tsx
<CardContent className="p-4 space-y-2">
  <div className="flex items-start justify-between gap-2">
    <h3 className="font-medium text-sm leading-tight line-clamp-2">{product.name}</h3>
    <Badge
      variant="secondary"
      className={`shrink-0 text-[10px] ${statusColors.bg} ${statusColors.text} ${statusColors.border} border`}
    >
      {statusLabel}
    </Badge>
  </div>
  {categoryName && (
    <p className="text-xs text-muted-foreground">{categoryName}</p>
  )}
  {product.status === 'inactive' && inactiveReason && (
    <p className="text-[10px] text-muted-foreground">
      {INACTIVE_REASON_LABELS[inactiveReason] || inactiveReason}
    </p>
  )}
  <div className="flex items-center justify-between pt-1">
    <span className="font-semibold text-sm">
      {product.price != null ? `${Number(product.price).toFixed(2)} €` : '—'}
    </span>
    <span className="text-xs text-muted-foreground">
      {product.quantity_on_hand} бр.
    </span>
  </div>
</CardContent>
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/products/product-card.tsx
git commit -m "feat: update ProductCard with new status colors and inactive reason"
```

---

### Task 7: Update ProductSearch Filter

**Files:**
- Modify: `src/components/products/product-search.tsx`

- [ ] **Step 1: Simplify status filter**

```typescript
// src/components/products/product-search.tsx

'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Всички' },
  { value: 'active', label: 'Активни' },
  { value: 'inactive', label: 'Неактивни' },
]

export default function ProductSearch() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [status, setStatus] = useState(searchParams.get('status') || 'all')

  const updateParams = useCallback(
    (newSearch: string, newStatus: string) => {
      const params = new URLSearchParams()
      if (newSearch) params.set('search', newSearch)
      if (newStatus && newStatus !== 'all') params.set('status', newStatus)
      router.push(`/catalog?${params.toString()}`)
    },
    [router]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      updateParams(search, status)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, updateParams, status])

  function handleStatusChange(value: string) {
    setStatus(value)
    updateParams(search, value)
  }

  return (
    <div className="flex gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Търсене на продукти..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={status} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Статус" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/products/product-search.tsx
git commit -m "feat: simplify product search filter to active/inactive/all"
```

---

### Task 8: Update getProducts for New Status Values

**Files:**
- Modify: `src/lib/db/products.ts`

- [ ] **Step 1: Verify status filter works with new values**

The current `getProducts` function filters `status` via `query.eq('status', filters.status)`. With new values ('active'/'inactive'), this works unchanged. No code changes needed.

But let's check if there are any places that hardcode `status = 'listed'`:

```bash
grep -r "'listed'" /Volumes/External/Users/filewizard/Documents/Apps/Prody/src --include='*.ts' --include='*.tsx'
```

Fix any hardcoded `'listed'` references in queries. Most importantly, the POS page and record-sale page filter by `status = 'listed'` — must change to `status = 'active'`.

- [ ] **Step 2: Update record-sale page query**

In `src/app/(seller)/record-sale/page.tsx`, change:
```typescript
.eq('status', 'listed')
```
to:
```typescript
.eq('status', 'active')
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(seller\)/record-sale/page.tsx
git commit -m "fix: update product queries from 'listed' to 'active' status"
```

---

### Task 9: Responsive POS Layout

**Files:**
- Modify: `src/components/pos/pos-client.tsx`
- Modify: `src/components/pos/product-grid.tsx`
- Modify: `src/components/pos/cart-sidebar.tsx`

- [ ] **Step 1: Update POSClient to responsive layout**

In `pos-client.tsx`, change the return JSX:

```tsx
return (
  <>
    {/* Desktop layout: 60/40 split */}
    <div className="hidden lg:flex gap-6 h-[calc(100vh-8rem)]">
      <div className="flex-1 min-w-0">
        <POSHeader stores={stores} selectedStoreId={selectedStoreId} onStoreChange={setSelectedStoreId} />
        <ProductGrid
          products={products}
          categories={categories}
          frequentlySold={frequentlySold}
          onAddToCart={handleAddToCart}
        />
      </div>
      <div className="w-[380px] shrink-0">
        <CartSidebar
          items={cart.items}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onSetQty={handleSetQty}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>
    </div>

    {/* Mobile/Tablet: stacked layout */}
    <div className="lg:hidden flex flex-col h-[calc(100vh-10rem)]">
      <div className="flex-1 overflow-hidden">
        <POSHeader stores={stores} selectedStoreId={selectedStoreId} onStoreChange={setSelectedStoreId} />
        <ProductGrid
          products={products}
          categories={categories}
          frequentlySold={frequentlySold}
          onAddToCart={handleAddToCart}
        />
      </div>
      {cart.items.length > 0 && (
        <CartBottomBar
          items={cart.items}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onSetQty={handleSetQty}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      )}
    </div>
  </>
)
```

Add POSHeader (inline helper to avoid splitting into too many files — it's small):

Actually, let's keep it simple and put the header/selector inline. Let me just add the `lg:hidden`/`lg:flex` wrappers and create a `CartBottomBar` component.

- [ ] **Step 2: Create CartBottomBar (inline in cart-sidebar.tsx)**

Add to bottom of `cart-sidebar.tsx`:

```typescript
// CartBottomBar — shown on mobile when cart has items
export function CartBottomBar({ items, onAdd, onRemove, onSetQty, onSubmit, submitting }: CartSidebarProps) {
  const total = items.reduce((sum, i) => sum + i.qty * (i.product.price ?? 0), 0)
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      {/* Collapsed bar */}
      <div className="sticky bottom-0 border-t bg-white p-3 flex items-center gap-3 shadow-lg">
        <button
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={() => setExpanded(!expanded)}
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-medium text-sm">Количка ({items.length})</span>
          <span className="text-sm font-bold ml-auto tabular-nums">{total.toFixed(2)} €</span>
        </button>
        <Button size="sm" onClick={onSubmit} disabled={submitting}>
          {submitting ? '...' : 'Завърши'}
        </Button>
      </div>

      {/* Expanded drawer */}
      {expanded && (
        <div className="fixed inset-x-0 bottom-0 z-50 bg-white border-t rounded-t-xl shadow-2xl max-h-[70vh] flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="font-semibold">Количка</h3>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>Готово</Button>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {items.map(item => (
              <div key={item.product.id} className="flex items-center gap-2 p-2 rounded-md border bg-slate-50/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7"
                    onClick={() => item.qty <= 1 ? onRemove(item.product.id) : onSetQty(item.product.id, item.qty - 1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-7 text-center text-sm tabular-nums">{item.qty}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7"
                    onClick={() => onAdd(item.product.id)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                  onClick={() => onRemove(item.product.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="p-3 border-t">
            <Button className="w-full" onClick={onSubmit} disabled={submitting}>
              Завърши продажба · {total.toFixed(2)} €
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
```

Note: you need `import { useState } from 'react'` at the top of cart-sidebar.tsx if not already there.

- [ ] **Step 3: Update product-grid.tsx for responsive columns**

Change grid:
```tsx
<div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
```

And the overflow wrapper:
```tsx
<div className="overflow-auto flex-1">
```

- [ ] **Step 4: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/pos/pos-client.tsx src/components/pos/product-grid.tsx src/components/pos/cart-sidebar.tsx
git commit -m "feat: responsive POS layout with mobile bottom cart bar"
```

---

### Task 10: Responsive Catalog Grid

**Files:**
- Modify: `src/app/(admin)/catalog/page.tsx`

- [ ] **Step 1: Update grid columns**

Change the grid class from:
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
```
to:
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
```

- [ ] **Step 2: Adjust page padding for mobile**

The layout already handles padding via `p-4 lg:p-8`. The catalog page just needs to remove its own extra wrapping. Current wrapper `<div className="space-y-6">` is fine.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(admin\)/catalog/page.tsx
git commit -m "feat: responsive catalog grid with 4 columns on xl screens"
```

---

### Task 11: Final Verification

- [ ] **Step 1: TypeScript check**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -40
```

Expected: zero errors.

- [ ] **Step 2: Build check**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npm run build 2>&1 | tail -20
```

Expected: successful build.

- [ ] **Step 3: Fix any issues and commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add -A
git commit -m "chore: fix compilation issues after status/responsive redesign"
```
