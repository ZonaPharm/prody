# Доставки — фаза 1: база (договор)

Source plan: Claude Doc "План: Доставки в Prody" (approved by Владимир, 10.11.2026). This file is the
contract for phase 1: database schema, atomic functions, and the server-side changes that must ship
with them. **No screens in this phase.** Production must keep working exactly as before when this
merges; nothing calls the new functions yet except `transfer_stock`.

Staging project: `ruhhsixmqusnpiajkbxe`. Production (`ocvmqlbfkloskabicxuw`) is never touched in phase 1.

## Process in one paragraph

An admin enters a delivery (lines: product, supplier, invoice no., quantity in units, unit cost incl. VAT,
pack size) with a per-store plan. Saving gives it a number (Д-000124) and status `expected`. Parcels are
received by checklist into the warehouse store ("Офис", `stores.is_warehouse = true`); stock enters
there. The repacker marks per plan row (product → store) what is labelled and ready. Products with
`needs_label = false` (teas, vitamins) become ready on receipt. A **trip** (driver run, К-000012) groups
one **shipment** per store (П-000045); a shipment collects ready rows for its store from **any number of
open deliveries**, even partially ready ones. Packing is a checklist; when the driver signs, the trip is
sent and stock moves Офис → stores atomically; it is sellable at once. The seller ticks what arrived;
anything short raises a **signal** and the missing units leave the store stock until an admin resolves
it. Every step is signed (user + time) in an append-only log. Офис also sells, so shipping takes from
Офис stock FIFO, not from the delivery's own batches.

## Migration A — `supabase/migrations/20261110_deliveries_schema.sql`

Additive only. Idempotent (`IF NOT EXISTS`, `DROP ... IF EXISTS` before re-create of policies/triggers,
`ON CONFLICT DO NOTHING` for seeds) so it can be re-applied on staging while iterating.

Sequences: `delivery_number_seq`, `shipment_number_seq`, `trip_number_seq` (start 1). UI formats
`Д-` / `П-` / `К-` + 6 digits; the DB stores integers.

Tables (all `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`):

| table | columns and rules |
|---|---|
| `suppliers` | `name text not null`, `is_active boolean not null default true`, `notes text`. Unique index on `lower(btrim(name))`. |
| `deliveries` | `number integer unique` (null while draft), `status text not null default 'draft'` check in (`draft`,`expected`,`in_progress`,`completed`,`cancelled`), `order_ref text`, `notes text`, `created_by uuid not null → users`, `updated_at timestamptz not null default now()` (use existing `set_updated_at` trigger), `completed_at`, `cancelled_at`, `cancelled_by → users`, `cancel_reason text`. |
| `delivery_items` | `delivery_id → deliveries not null` (on delete cascade — only drafts are ever deleted), `product_id → products not null`, `supplier_id → suppliers` (null ok), `doc_number text`, `pack_size integer not null default 1 check > 0`, `quantity integer not null check > 0` (units), `unit_cost numeric(12,4) not null check >= 0` (per unit, incl. VAT), `received_qty integer not null default 0`, `sort_order integer not null default 0`. Check `0 <= received_qty <= quantity`. Index on `delivery_id`, `product_id`. |
| `delivery_item_plan` | `delivery_item_id → delivery_items not null` (cascade), `store_id → stores not null`, `planned_qty integer not null check >= 0`, `ready_qty integer not null default 0`, `shipped_qty integer not null default 0`. Check `0 <= shipped_qty <= ready_qty <= planned_qty`. Unique (`delivery_item_id`, `store_id`). The warehouse store may not appear here (enforced in functions). |
| `trips` | `number integer unique not null default nextval('trip_number_seq')`, `status text not null default 'open'` check in (`open`,`departed`,`completed`), `driver_id → users` (null until sent), `notes text`, `created_by → users not null`, `departed_at`, `completed_at`. |
| `shipments` | `number integer unique not null default nextval('shipment_number_seq')`, `trip_id → trips not null`, `store_id → stores not null`, `status text not null default 'packing'` check in (`packing`,`packed`,`sent`,`received`,`received_with_issues`), `box_count integer check > 0`, `packed_by → users`, `packed_at`, `sent_by → users`, `sent_at`, `received_by → users`, `received_at`, `created_by → users not null`. Unique (`trip_id`, `store_id`). |
| `shipment_lines` | `shipment_id → shipments not null` (cascade), `plan_id → delivery_item_plan not null`, `delivery_item_id → delivery_items not null`, `product_id → products not null`, `qty integer not null check > 0`, `received_qty integer` (null until the store confirms; check `0 <= received_qty <= qty`). Unique (`shipment_id`, `plan_id`). |
| `delivery_signals` | `delivery_id → deliveries` (null for store signals spanning deliveries is NOT allowed — always set from the line), `delivery_item_id → delivery_items`, `shipment_id → shipments`, `shipment_line_id → shipment_lines`, `step text not null` check in (`receive`,`label`,`pack`,`store_receive`), `reason text not null` check in (`short`,`partial`,`damaged`,`wrong_product`,`wrong_label`,`missing`,`other`), `qty_expected integer`, `qty_actual integer`, `note text`, `status text not null default 'open'` check in (`open`,`resolved`), `resolution text` check in (`corrected`,`returned_to_supplier`,`found`,`other`), `resolution_note text`, `created_by → users not null`, `resolved_by → users`, `resolved_at`. Check: `status = 'resolved'` ⇔ `resolution`, `resolved_by`, `resolved_at` not null. Partial index on open signals. |
| `delivery_events` | the signed log. `delivery_id → deliveries` (null ok for trip-level events), `delivery_item_id`, `plan_id`, `trip_id`, `shipment_id`, `signal_id` (all nullable FKs), `type text not null` check in (`created`,`saved`,`received`,`plan_changed`,`ready`,`trip_created`,`packed`,`sent`,`store_received`,`signal_raised`,`signal_resolved`,`cancelled`,`completed`), `store_id → stores`, `qty integer`, `details jsonb not null default '{}'`, `created_by → users not null`. Index on `delivery_id`, `created_by`, `created_at`. **Append-only:** a `BEFORE UPDATE OR DELETE` trigger raises `'delivery_events is append-only'` for every role. |

Existing tables (nullable columns only, no rewrites of existing rows):

- `products.needs_label boolean not null default true`.
- `stock_batches.delivery_item_id uuid → delivery_items` (null for all old batches).
- `stock_movements.delivery_id uuid → deliveries`, `stock_movements.shipment_id uuid → shipments`.
- `stock_movements_type_check`: drop and re-add with the same six values plus `delivery_cancel`. Comment in
  the migration that this takes a brief lock on `stock_movements` and must run outside working hours in prod.

RLS: enable on every new table. Policies, `TO authenticated`:

- Admin read on all new tables: `USING (public.is_admin())` (the existing SECURITY DEFINER helper).
- Seller read on `shipments` where `store_id = (select store_id from public.users where id = auth.uid())`,
  and on `shipment_lines` whose shipment matches the same rule. Sellers see nothing else: no deliveries,
  no costs, no signals of other stores.
- No INSERT/UPDATE/DELETE policies: all writes go through the API with the service role and the functions below.
- `REVOKE ALL ON <each new table> FROM anon;` sequences too.

Supplier seed (from `products.source`; **do not modify `products.source`**, old code still reads it):
insert one supplier per distinct trimmed non-empty source, with these merges approved by Владимир:
`Temu`, `Тему`, `тему`, `ТЕМУ` → `Temu`; `Панацея`, `Панацея 2001` → `Панацея 2001`. Everything else as
written. Other likely duplicates (`Аксон`/`Ааксон`/`Аксом`, `Zein Pharma`/`ЗЕЙН ФАРМА`, `Temu/ MERCILEN`,
`Тему Sadoer`, `Sadoer`) stay separate and are listed in the PR for Владимир to decide.

## Migration B — `supabase/migrations/20261110_deliveries_functions.sql`

Every function: `LANGUAGE plpgsql`, SECURITY INVOKER, `SET search_path TO ''`, fully qualified names,
`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;`
(Supabase grants EXECUTE to anon/authenticated directly — revoking from PUBLIC alone is not enough).
Follow `20261109_sell_from_batches_atomically.sql`: lock with `FOR UPDATE`, batches in `(created_at, id)`
order, counters as `quantity_on_hand ± n` (never recomputed), raise in Bulgarian on any rule violation so
the whole call rolls back. Lock several products in `product_id` order to avoid deadlocks. Every function
takes `p_user uuid` (the signed-in user, passed by the API) and writes `delivery_events` rows with it.
Errors the UI shows: Bulgarian, specific (product name, available vs requested).

Warehouse: exactly one active store with `is_warehouse = true`; otherwise raise.

1. `transfer_stock(p_product_id, p_from_store, p_to_store, p_quantity, p_user, p_notes text default null) returns integer`
   — atomic replacement for `/api/inventory/transfer`: FIFO from the source store's batches, `transfer_out`
   per batch, a new batch in the target store at the same unit cost per source batch, `transfer_in`,
   `source_store_id` set like today. `quantity_on_hand` unchanged. Same store → raise. Returns batches touched.
2. `save_delivery(p_delivery_id, p_user) returns integer` — draft → `expected`, assigns `number` from the
   sequence, validates: at least one item; per item `sum(planned_qty) <= quantity`; no plan row for the
   warehouse. Event `saved`. Returns the number.
3. `receive_delivery(p_delivery_id, p_user, p_lines jsonb) returns jsonb` — `p_lines = [{item_id, qty}]`,
   qty > 0. Delivery must be `expected` or `in_progress`. Per line: lock the item, require
   `received_qty + qty <= quantity`, insert a batch in Офис (`unit_cost`, `delivery_item_id`), a `restock`
   movement with `delivery_id`, `quantity_on_hand + qty`, `received_qty + qty`, `products.cost_price = unit_cost`.
   If the product has `needs_label = false`, mark ready on its plan rows (in store-name order) up to
   `planned - ready`, bounded by what is received and not yet ready. Status → `in_progress`. Events `received`
   (and `ready` for auto-ready). Returns `{received: n, auto_ready: n}`.
4. `update_plan(p_item_id, p_user, p_rows jsonb) returns void` — `[{store_id, planned_qty}]`, upsert. Each
   row's `planned_qty >= ready_qty`; `sum(planned) <= quantity`; warehouse not allowed. A store not yet in
   the plan may be added only from the unallocated remainder (same sum rule covers it). Not allowed on
   `completed`/`cancelled`. Event `plan_changed` with before/after in `details`.
5. `mark_ready(p_user, p_rows jsonb) returns void` — `[{plan_id, qty}]`, qty may be negative to correct
   (never below `shipped_qty`). Per item: `sum(ready_qty) <= received_qty`. Event `ready` per row.
6. `create_trip(p_user, p_store_ids uuid[], p_notes text default null) returns jsonb` — creates a trip and,
   per store, a `packing` shipment with one line per plan row of that store where
   `ready - shipped - qty already on other unsent shipments > 0`, across all deliveries in
   `in_progress`/`expected`. Stores with nothing ready get no shipment. No ready rows at all → raise.
   Event `trip_created`. Returns `{trip_id, number, shipments: [{shipment_id, number, store_id, lines}]}`.
7. `pack_shipment(p_shipment_id, p_user, p_lines jsonb, p_box_count integer) returns void` —
   `[{line_id, qty}]`: qty = packed amount, `0 < qty <= line.qty` lowers the line, `0` deletes it. Lines not
   listed stay as they are. Shipment must be `packing`; → `packed`, `packed_by/at`, `box_count`. Event `packed`.
8. `send_trip(p_trip_id, p_driver uuid) returns jsonb` — trip `open`, every shipment `packed`, at least one
   line. All lines of all shipments, ordered by `product_id`: lock Офис batches of the product FIFO,
   require enough (else raise naming product, needed, available), move like `transfer_stock` with
   `shipment_id` and `delivery_id` on the movements and `delivery_item_id` on the new store batches;
   `plan.shipped_qty += qty` (must stay `<= ready_qty`). Shipments → `sent`, trip → `departed`,
   `driver_id`, `sent_by = p_driver`. One transaction for the whole trip. Event `sent` per shipment.
9. `confirm_shipment(p_shipment_id, p_user, p_lines jsonb) returns jsonb` — `[{line_id, received_qty, reason, note}]`,
   every line of the shipment must be listed. `p_user` must be an admin or a user whose `store_id` is the
   shipment's store. Shipment must be `sent`. For each short line (`received_qty < qty`): a `store_receive`
   signal (reason required, default `short`), and the missing units leave the store: FIFO deduction from
   that store's batches of the product, `correction` movements with `shipment_id`, `quantity_on_hand - n`
   (if the store has already sold some, deduct what is there and record the remainder in the signal's
   `note`). Status → `received` or `received_with_issues`; trip → `completed` when all its shipments are
   received. Event `store_received`. Then run the completion check for every affected delivery.
10. `raise_signal(p_user, p_step, p_reason, p_delivery_item_id, p_shipment_line_id, p_qty_expected, p_qty_actual, p_note) returns uuid`
    — for `receive`/`label`/`pack` steps (no stock change). Event `signal_raised`.
11. `resolve_signal(p_signal_id, p_user, p_resolution, p_note) returns void` — admin only (check
    `users.role = 'admin'`). For a `store_receive` signal resolved as `found`: put the missing units back
    into the store (new batch at the line's unit cost, `correction` +n, `quantity_on_hand + n`). Other
    resolutions change no stock. Event `signal_resolved`, then completion check.
12. `cancel_delivery(p_delivery_id, p_user, p_reason) returns void` — only if no plan row has
    `shipped_qty > 0`. Every Офис batch with `delivery_item_id` of this delivery must still hold its full
    received quantity (else raise: something was sold or moved). Deduct them, `delivery_cancel`
    movements, `quantity_on_hand - n`, status `cancelled`. A draft (no receipts) is simply cancelled.
13. Internal `_complete_delivery_if_done(p_delivery_id, p_user)` (also service_role only): `completed` when
    every item is fully received, every plan row has `shipped_qty = planned_qty`, every shipment carrying
    its items is received, and it has no open signal. Event `completed`.

## Server changes (TypeScript)

- `src/app/api/inventory/transfer/route.ts` → one `rpc('transfer_stock', …)` call; keep the request/response
  shape (`{success, transferred}`), keep `logAction`. Both callers (transfer form, requests screen) keep working.
  Map the function's Bulgarian errors to HTTP 400.
- `src/lib/backup.ts` `TABLES`: add the nine new tables in FK-safe order after `stores`/`products`
  (`suppliers`, `deliveries`, `delivery_items`, `delivery_item_plan`, `trips`, `shipments`, `shipment_lines`,
  `delivery_signals`, `delivery_events`) — check how restore orders inserts and that `stock_batches`
  (which now references `delivery_items`) restores after them.
- `src/lib/integrity-rules.ts` (+ `.test.ts`) and `src/lib/integrity-check.ts`: new checks as pure functions —
  (error) a plan row with `shipped > ready` or `ready > planned`; (error) an item with `sum(ready) > received`;
  (warning) Офис stock of a product below `sum(ready - shipped)` over open plan rows ("ready but not in
  Офис"); (warning) a shipment `sent` for more than 3 days without store confirmation. Fetch with
  `fetchAll`. Existing checks unchanged.
- Remove the committed `.env.vercel` and `.env.vercel.prod` from git (they hold a Vercel OIDC token) and
  ignore `.env*` except `.env.example`.

## Tests

- `supabase/tests/deliveries.test.sql`, style of `sell_from_batches.test.sql` (self-contained, synthetic
  rows, every scenario rolls back, one row per test with `passed`). At least: save numbers a draft and
  rejects over-planning; receive into Офис moves counter and cost; receive over quantity raises;
  needs_label=false auto-ready; mark_ready over received raises; update_plan below ready raises and
  off-plan store from remainder works; create_trip collects rows from two deliveries for one store and
  skips stores with nothing; send_trip moves stock FIFO from Офис, keeps qoh, sets counters; send_trip
  raises when Офис was sold out in between and changes nothing; confirm_shipment short line creates a
  signal and removes units from the store; resolve `found` puts them back; completion; cancel before and
  after shipping; transfer_stock FIFO and same-store error; delivery_events update/delete raise; anon and
  authenticated cannot execute any new function; a seller sees only own-store shipments (via
  `set local role authenticated` + `request.jwt.claims`).
- Concurrency (staging, two sessions via dblink, like 9 Nov): `send_trip` and `sell_from_batches` on the
  same Офис product at once leave batches and counter consistent.
- Vitest: integrity rules; transfer route maps RPC errors.
