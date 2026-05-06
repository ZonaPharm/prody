# Unified POS Page Design

**Date**: 2026-05-06
**Status**: Approved
**Replaces**: `/record-sale`, `/seller-catalog`

## Overview

Replace the current single-product record-sale page with a unified POS that combines product browsing (categories, search, frequently sold) with a multi-product cart for grouped sales.

## Architecture

Approach: Client-heavy single page. Server component fetches initial data, client component holds all interactive state.

```
app/(seller)/record-sale/page.tsx        ← POSPage (server)
  └─ POSClient (client)
       ├─ StoreSelect (admin only)       ← existing, re-used
       ├─ SearchBar
       ├─ CategoryPills
       ├─ FrequentlySold
       ├─ ProductGrid
       └─ CartSidebar
            ├─ CartItem[] (+/- qty, remove)
            ├─ TotalRow
            └─ SubmitButton
```

- **POSPage** (server): parallel fetch products, categories, frequently sold, stores. Pass as props.
- **POSClient** (client): all state — search query, selected category, selected store, cart.
- **SaleEntry**: removed, replaced by POSClient.
- **`/(seller)/catalog`**: redirect to `/record-sale`.

## Cart State

`useReducer` with actions: ADD, REMOVE, SET_QTY, CLEAR.

- ADD: if product already in cart → increment qty, else add new item
- SET_QTY: if qty <= 0 → remove product
- Total: `useMemo` from items, not stored in state

## Layout

Fixed 60/40 split:
- Left (60%): CategoryPills → SearchBar → FrequentlySold (horizontal scroll) → ProductGrid (3-4 columns)
- Right (40%): CartSidebar always visible

Compact product cards: image, name, price. No description.

## Product Discovery

1. **Category pills**: horizontal row, click to filter product grid
2. **Search bar**: text filters grid by name/barcode/SKU. No auto-add. Filters only.
3. **Frequently sold**: first 6 from seller's own history + next 6 from store-wide top sellers. Horizontal scroll above main grid.

## Cart Behavior

- Click product in grid → add to cart with qty 1
- +/- buttons in cart to adjust quantity
- X button to remove
- "Finish Sale" button at bottom of cart
- On success: toast + clear cart, ready for next sale
- On error: toast with error, cart NOT cleared

## Database

```sql
ALTER TABLE sales ADD COLUMN sale_group_id uuid;
CREATE INDEX idx_sales_sale_group ON sales(sale_group_id);
```

- Nullable — existing rows stay NULL
- All POS sales have `sale_group_id`
- Existing RLS unchanged

## API

`POST /api/sales/group`:

Request: `{ store_id, items: [{ product_id, quantity, unit_price }] }`
Response 200: `{ success: true, sale_group_id, count }`
Response 400: `{ error: "At least one product required" }`
Response 403: `{ error: "No access to this store" }`

Server logic:
1. Validate items.length > 0
2. Verify user access to store_id
3. Generate `sale_group_id = crypto.randomUUID()`
4. Batch insert all rows
5. Return result

## Empty States

- No products: icon + "No products available"
- Search no results: "No matches for '{query}'"
- Empty cart: "Add products from the grid" in muted text
- Error on submit: toast, cart preserved

## What Gets Removed/Replaced

- `SaleEntry` component (337 lines) — replaced by POSClient
- `app/(seller)/catalog/` — redirect to /record-sale
- Current `/record-sale` page.tsx — overwritten

## What Stays

- `/my-sales` page
- `StoreSelect` component (re-used in POSClient for admins)
- All existing API routes (except new `/api/sales/group` added)
