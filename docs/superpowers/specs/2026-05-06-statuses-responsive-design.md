# Status System & Responsive Layout Redesign

**Date**: 2026-05-06
**Status**: Approved

## Overview

Two improvements:
1. Simplify product statuses from 5 confusing labels to 2 clear states (Active/Inactive)
2. Make all layouts responsive with proper mobile/tablet support

---

## 1. Status System

### Current (5 statuses, confusing)

| Status | RLS behavior | Badge | Problem |
|--------|-------------|-------|---------|
| `ordered` | Hidden from sellers | secondary (gray) | Looks like listed |
| `received` | Hidden from sellers | outline (border-only) | Looks like listed |
| `listed` | Visible to sellers | default (gray) | Looks like ordered |
| `damaged` | Hidden | destructive (red) | Same as returned |
| `returned` | Hidden | destructive (red) | Same as damaged |

### New (2 statuses, clear)

| Status | RLS behavior | Badge | Color |
|--------|-------------|-------|-------|
| `active` | Visible to sellers, appears in POS | Зелен | `#22c55e` |
| `inactive` | Hidden from sellers | Сив с причина | `#94a3b8` |

### Mapping

```
ordered  → inactive (reason: "ordered")
received → inactive (reason: "received")
listed   → active
damaged  → inactive (reason: "damaged")
returned → inactive (reason: "returned")
```

### Database

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS inactive_reason text;
-- Migrate existing data:
UPDATE products SET status = 'active' WHERE status = 'listed';
UPDATE products SET status = 'inactive', inactive_reason = status WHERE status != 'listed';
-- Update check constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check CHECK (status IN ('active', 'inactive'));
```

### RLS Update

Change from `status = 'listed'` to `status = 'active'`:

```sql
DROP POLICY IF EXISTS "Sellers read listed products" ON products;
CREATE POLICY "Sellers read active products" ON products
  FOR SELECT USING (status = 'active');
```

### Components Updated

- `STATUS_LABELS`, `STATUS_VARIANTS` in constants.ts
- `ProductCard` — badge with inactive_reason tooltip
- `ProductSearch` — filter dropdown: Active/Inactive/All
- `ProductForm` — radio/toggle for Active/Inactive + reason dropdown when inactive

---

## 2. Responsive Layout

### Header/Top Bar (new)

Every layout gets a shared header component:

```
┌─────────────────────────────────────────────────┐
│ [☰] Prody  │  Page Title    │ [SwitchRole] [👤] │
└─────────────────────────────────────────────────┘
```

- Sticky top, `h-14`, `border-b`, `bg-white`
- Left: hamburger (mobile) + app name
- Center: page title / breadcrumb
- Right: SwitchRoleButton (admin only) + user avatar
- Replaces the inline `p-8` page titles scattered across pages

### Sidebar

- **Desktop (≥1024px)**: `w-56` (224px), same dark theme. Hamburger toggles collapse to icons-only (`w-14`, 56px).
- **Tablet/Mobile (<1024px)**: Overlay sidebar, slides from left. Hamburger in top bar opens it. Backdrop closes it. Uses Sheet/Drawer pattern with Radix Dialog.
- **No bottom tab bar** — sidebar overlay is sufficient.

### Layout Shell (admin + seller)

```
<div className="flex min-h-screen flex-col">
  <Header />          ← new, shared
  <div className="flex flex-1">
    <Sidebar />       ← responsive (overlay on mobile)
    <main>{children}</main>
  </div>
</div>
```

### POS Page

- **Desktop**: `flex gap-6` 60/40 split (unchanged, but with responsive wrappers)
- **Tablet (<1024px)**: Stack vertically. Product grid full-width. Cart becomes a sticky bottom bar ("Количка (3) · 45.50 € [Завърши]").
- **Mobile (<640px)**: Same as tablet, but product grid 2 columns, cart bottom bar.

### Catalog (admin)

- `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- Product cards: same compact layout, just adapt column count.

### My Sales, Reports, Settings pages

- `max-w-2xl` → responsive, full-width on mobile with padding
- Tables scroll horizontally on mobile

---

## 3. What Changes

| File | Change |
|------|--------|
| `src/lib/constants.ts` | New STATUS_LABELS, STATUS_VARIANTS |
| `supabase/migrations/00006_*.sql` | Status migration |
| `src/components/ui/header.tsx` | NEW — top bar |
| `src/app/(admin)/layout.tsx` | Add Header, responsive sidebar |
| `src/app/(seller)/layout.tsx` | Add Header, responsive sidebar |
| `src/components/products/product-card.tsx` | New badge colors, inactive_reason |
| `src/components/products/product-search.tsx` | Simplified filter |
| `src/components/pos/pos-client.tsx` | Responsive layout |
| `src/components/pos/product-grid.tsx` | Responsive grid columns |
| `src/components/pos/cart-sidebar.tsx` | Responsive + bottom bar |
| `src/app/(admin)/catalog/page.tsx` | Responsive grid |
| `src/lib/db/products.ts` | Update status filter |
