# Inventory Management — Stock Movements & FIFO Tracking

**Date**: 2026-05-07
**Status**: Approved

## Overview

Add full inventory traceability: stock movements (restock, sell, transfer), FIFO batch tracking, per-store inventory visibility, and automatic profit calculation based on actual batch cost.

---

## 1. Database

### New Table: `stock_batches`

```sql
CREATE TABLE stock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  quantity_remaining int NOT NULL CHECK (quantity_remaining >= 0),
  unit_cost decimal(10,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_batches_product_store ON stock_batches(product_id, store_id);
CREATE INDEX idx_batches_remaining ON stock_batches(product_id, store_id, quantity_remaining) WHERE quantity_remaining > 0;
```

### New Table: `stock_movements`

```sql
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) NOT NULL,
  store_id uuid REFERENCES stores(id) NOT NULL,
  batch_id uuid REFERENCES stock_batches(id),
  type text NOT NULL CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out')),
  quantity int NOT NULL,
  unit_cost decimal(10,2),
  unit_price decimal(10,2),
  source_store_id uuid REFERENCES stores(id),
  sale_id uuid REFERENCES sales(id),
  notes text,
  created_by uuid REFERENCES users(id) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movements_product ON stock_movements(product_id);
CREATE INDEX idx_movements_store ON stock_movements(store_id);
CREATE INDEX idx_movements_type ON stock_movements(type);
CREATE INDEX idx_movements_created ON stock_movements(created_at);
```

### RLS Policies

```sql
-- Admins full access
CREATE POLICY "Admins full access batches" ON stock_batches FOR ALL USING (admin_check());
CREATE POLICY "Admins full access movements" ON stock_movements FOR ALL USING (admin_check());

-- Sellers read their own store's batches/movements
CREATE POLICY "Sellers read own store batches" ON stock_batches FOR SELECT USING (store_id = seller_store_id());
CREATE POLICY "Sellers read own store movements" ON stock_movements FOR SELECT USING (store_id = seller_store_id());
```

### Migration: products table update

```sql
-- Add parent_store_id for "Офис" as central warehouse concept
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_warehouse boolean DEFAULT false;
-- Mark the "Офис" store as warehouse
UPDATE stores SET is_warehouse = true WHERE name ILIKE '%офис%';
```

---

## 2. How It Works

### 2.1 Restock (Зареди)

**Trigger:** Admin clicks "Зареди" on product detail page.

1. Admin enters: total quantity, unit cost, optional per-store distribution
2. Default: all quantity goes to "Офис" (warehouse)
3. If distributed: quantities allocated to specific stores
4. System creates one `stock_batch` per store that receives quantity
5. System creates `stock_movement` type='restock' per batch created
6. Product `quantity_on_hand` is updated (incremented)

### 2.2 Sell (Продай)

**Trigger:** Sale completed in POS.

1. Only after successful sale insert in `sales` table
2. System finds active batches for the sold product in the seller's store, ordered by `created_at ASC` (FIFO)
3. Deducts from oldest batch first, moves to next if needed
4. Creates `stock_movement` type='sell' with `sale_id` reference
5. Records `unit_cost` (from batch) and `unit_price` (from sale) for profit tracking
6. Product `quantity_on_hand` is decremented (already handled by existing code)

### 2.3 Transfer (Прехвърли)

**Trigger:** Admin clicks "Прехвърли" on product detail or inventory page.

1. Admin selects: source store, target store, quantity
2. System deducts from source store's oldest batch (FIFO)
3. Creates `stock_movement` type='transfer_out' (negative qty)
4. Creates new batch in target store with same unit_cost
5. Creates `stock_movement` type='transfer_in' (positive qty)
6. Product total quantity unchanged, just redistributed

---

## 3. UI Components

### 3.1 Product Detail — "Движения" Tab

New tab in admin product detail page showing:
- **Current stock per store** — table: store name | available quantity | value (qty × cost)
- **Active batches** — table: store | remaining qty | unit cost | age
- **Movement history** — table: date | type (badge) | store | qty | batch cost | notes
- **Actions** — "Зареди" button + "Прехвърли" button

### 3.2 Restock Form (Modal or inline)

```
┌─────────────────────────────────────────┐
│ Зареждане: [Product Name]              │
│                                         │
│ Количество: [___] бр.                   │
│ Доставна цена: [___] €                 │
│                                         │
│ Разпределение по магазини:             │
│ ┌──────────────┬──────────┬──────────┐ │
│ │ Магазин       │ Заделено │ Оставащо │ │
│ │ Офис (склад)  │ [___]    │   [auto] │ │
│ │ Ботев София   │ [___]    │          │ │
│ │ Ботев Бургас  │ [___]    │          │ │
│ │ Заимов        │ [___]    │          │ │
│ └──────────────┴──────────┴──────────┘ │
│                                         │
│ [Отказ] [Зареди]                       │
└─────────────────────────────────────────┘
```

- Default store is "Офис" (warehouse)
- Unallocated quantity shows in [auto] column
- Stores that are not warehouse can receive allocation
- Not mandatory to fill all stores

### 3.3 Stock Movement History (reusable component)

Table with: date, type badge (color coded), store, quantity (+/-), unit cost, notes
- `restock`: green "+100"
- `sell`: red "-5"  
- `transfer_in`: blue "+30"
- `transfer_out`: orange "-30"

---

## 4. API Endpoints

### POST `/api/inventory/restock`
Body: `{ product_id, quantity, unit_cost, distribution: [{ store_id, quantity }] }`
Creates batches + movements. Updates product quantity.

### POST `/api/inventory/transfer`
Body: `{ product_id, from_store_id, to_store_id, quantity }`
Moves stock between stores. Preserves batch cost.

### GET `/api/inventory/product/{id}`
Returns: `{ batches, movements, stock_per_store }`

### GET `/api/inventory/movements`
Query: `?product_id=&store_id=&type=&from=&to=`
Paginated movement history.

---

## 5. POS Integration (Modified)

After successful group sale:
1. For each sold item, call FIFO deduction
2. Find oldest batch for product_id + store_id with `quantity_remaining > 0`
3. Deduct from batch(es), create sell movements
4. If insufficient stock → rollback sale (should not happen, product query already filters qty>0)

---

## 6. What Gets Modified

| File | Change |
|------|--------|
| `supabase/migrations/00007_*.sql` | New tables + RLS |
| `src/lib/inventory.ts` | NEW — FIFO logic, batch operations |
| `src/app/api/inventory/restock/route.ts` | NEW |
| `src/app/api/inventory/transfer/route.ts` | NEW |
| `src/app/api/inventory/product/[id]/route.ts` | NEW |
| `src/components/inventory/movement-history.tsx` | NEW |
| `src/components/inventory/restock-form.tsx` | NEW |
| `src/components/inventory/stock-per-store.tsx` | NEW |
| `src/app/(admin)/catalog/[id]/page.tsx` | Add "Движения" tab |
| `src/app/api/sales/group/route.ts` | Add FIFO deduction after sale |
| `src/app/(seller)/record-sale/page.tsx` | Filter by per-store stock |
