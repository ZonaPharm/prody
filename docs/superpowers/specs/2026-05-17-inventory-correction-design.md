# Inventory Correction Design

> Spec for stock correction / inventory adjustment feature in Prody.

**Goal:** Allow admin to correct product stock quantities when physical count differs from system count, with full audit trail and ability to rollback.

**Status:** DRAFT — pending user review

---

## Problem

- When a restock is entered with wrong quantity (e.g., 100 instead of 80), system shows 20 phantom units
- Sales can proceed against phantom stock — physical product runs out before system shows 0
- No mechanism exists to correct stock levels after entry errors, product damage, expiry, etc.
- The only way to fix is raw SQL in the database

## Scenarios

### Scenario 1: Less entered than actual (system: 50, real: 60)
Already solvable via restock + transfer. No new feature needed.

### Scenario 2: More entered than actual (system: 100, real: 80)
**This is what we're building.** Correction reduces stock by -20 with reason + audit.

### Bonus: Correction upward (system: 0, real: 5)
Same feature handles positive adjustments too (found product not in system).

---

## Architecture

### New page: `/(admin)/inventory`

Three-step flow:
1. **Select product + store** — product search combobox + store dropdown
2. **Enter actual count** — system shows current stock; admin enters physical count; diff calculates live
3. **Confirm** — select reason, optional note, save. Correction recorded with full audit.

Also shows recent corrections history below the form.

### New API: `POST /api/inventory/correct`

Single endpoint. Admin-only. Accepts `{ product_id, store_id, actual_quantity, reason, notes }`. Returns correction result.

---

## Database Changes

### Migration: `00020_inventory_correction.sql`

```sql
-- 1. Add 'correction' to stock_movements type check
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

ALTER TABLE stock_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access corrections" ON stock_corrections FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);
```

### Rollback migration: `00020_inventory_correction_rollback.sql`

```sql
-- Drop policies
DROP POLICY IF EXISTS "Admins full access corrections" ON stock_corrections;
-- Drop table
DROP TABLE IF EXISTS stock_corrections;
-- Restore original constraint
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check 
  CHECK (type IN ('restock', 'sell', 'transfer_in', 'transfer_out', 'void'));
```

---

## API Logic (`POST /api/inventory/correct`)

### Request
```json
{
  "product_id": "uuid",
  "store_id": "uuid",
  "actual_quantity": 80,
  "reason": "wrong_entry",
  "notes": "Неправилно заведени 100 вместо 80"
}
```

### Processing
1. Auth check (admin only)
2. Fetch all batches for product×store, sum `quantity_remaining` = system total
3. `diff = actual_quantity - system_total`
4. If `diff === 0` → return 400 "Няма разлика в наличностите"
5. If `diff < 0` (decrease): FIFO deduct from batches until diff covered
6. If `diff > 0` (increase): add to newest batch or create new one with `unit_cost = 0`
7. Record `stock_movements` row (type: 'correction', quantity: diff)
8. Record `stock_corrections` row (old_qty, new_qty, reason, notes)
9. Record `audit_logs` row (action: 'stock_correction')
10. Update `products.quantity_on_hand`

### Response
```json
{
  "correction": {
    "id": "uuid",
    "product_name": "Аналгин 500mg",
    "store_name": "Аптека Център",
    "old_quantity": 100,
    "new_quantity": 80,
    "difference": -20,
    "reason": "wrong_entry",
    "notes": "...",
    "created_at": "..."
  }
}
```

---

## UI (`/(admin)/inventory/page.tsx`)

### Server component
- Fetches stores list, passes to client

### Client component (`inventory-client.tsx`)
Three steps with visual progress indicator:

**Step 1: Select**
- Product combobox (search by name/barcode, same pattern as product-search.tsx)
- Store dropdown (from stores list)
- "Напред" button (disabled until both selected)

**Step 2: Count**
- Large display of current system stock: "Системна наличност: **100 бр.**"
- Input field: "Реална наличност" (number, min 0)
- Live diff display: "Разлика: **-20 бр.**" (green positive, red negative, gray if 0)
- "Назад" / "Запиши корекция" buttons
- Save is disabled if diff === 0

**Step 3: Reason**
- Select: причина (5 options in Bulgarian)
- Textarea: бележка (optional)
- "Назад" / "Потвърди корекция" buttons
- On confirm: API call → success toast → reset form

### Recent corrections table
Below the form: last 10 corrections for this store, with columns:
Date | Product | Store | Old → New | Diff | Reason | Who

### Navigation
New nav item: "Инвентаризация" with ClipboardList icon, between "Отчети" and "Заявки".

Route: `/inventory` inside `(admin)` group.

---

## Correction Reasons (Bulgarian labels)

| Value | Label |
|-------|-------|
| `wrong_entry` | Грешно въвеждане |
| `damaged` | Повреден продукт |
| `expired` | Изтекъл срок |
| `inventory_count` | Установено при инвентаризация |
| `other` | Друго |

---

## Rollback Strategy

### Before migration
1. **Supabase dump** — export full database via Supabase CLI or dashboard backup
2. Commit the rollback SQL migration alongside the main one

### After deployment if something is wrong
1. Apply `00020_inventory_correction_rollback.sql`
2. Remove the `/inventory` page files
3. Remove nav item
4. Revert commit
5. Redeploy

### Granular rollback
- Individual corrections cannot be "undone" via UI in v1 — but a new correction can reverse the numbers
- Full rollback of the feature is always possible via the SQL rollback script

---

## What this does NOT do (scope boundaries)

- No bulk/mass inventory count (full store inventory) — product-by-product only
- No mobile app integration
- No seller access — admin only
- No automatic detection of discrepancies
- No "undo" button per correction (use opposite correction instead)
- Does not delete or modify existing batches beyond quantity_remaining

---

## Backup Protocol

```
# 1. Supabase dashboard → Database → Backups → Create backup
# OR via CLI:
supabase db dump --db-url "$DATABASE_URL" --file backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Verify backup size is non-trivial

# 3. Proceed with migration
```

---

## Self-Review

- [x] No placeholders or TBDs
- [x] API contract is explicit
- [x] Database changes are reversible
- [x] UI flow is specific (3 steps)
- [x] Scope is clear (what's in, what's out)
- [x] Rollback plan is documented
