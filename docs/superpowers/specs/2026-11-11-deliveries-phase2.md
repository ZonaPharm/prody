# Доставки — фаза 2: въвеждане и получаване

Builds on phase 1 (`2026-11-10-deliveries-phase1-db.md`, PR #5). Plan: Claude Doc "План: Доставки в Prody".
Phase 3 (labelling checklist, trips and shipments, the store's checklist, "Проблеми") is not here;
phases 2 and 3 go to production together, hidden behind the switch until then.

## Feature switch

`DELIVERIES_ENABLED` (server env, read per request in `src/lib/deliveries/feature.ts`):
`all` → every admin; a list of e-mails → only those admins (pilot); `off` → nobody;
unset → on in Vercel preview and `next dev` (both use staging), off in production.
Off means: no menu item, no Settings tab, pages 404, API routes 404.

## Database (migration `20261111_deliveries_draft_receive.sql`, additive)

- `save_delivery_draft(p_delivery_id, p_user, p_expected_updated_at, p_draft)` — the entry screen's
  autosave. Creates the draft (event `created`) or overwrites one that is still a draft; refuses when
  `updated_at` moved since the screen read it (another admin saved). Lines with an id are updated,
  new lines inserted, unlisted lines deleted; each line's plan is replaced by its rows above 0.
  Over-planning is allowed in a draft (save_delivery refuses it). `needs_label` is written to the product
  only when the person changed "Без етикет" on the screen (all lines of that product follow).
- `receive_delivery_checked(p_delivery_id, p_user, p_lines, p_signals)` — one signed receiving
  checklist: `raise_signal(step 'receive')` per "Не е наред" row, then `receive_delivery` for the units
  that came, all in one transaction.
- Both service_role only. Tests: `supabase/tests/deliveries_phase2.test.sql` (staging, rolled back).

## Screens

- `/deliveries` — list (Отворени / Завършени / Отказани / Всички, text filter), received progress,
  open problems badge.
- `/deliveries/new`, `/deliveries/[id]` while a draft — entry: search (name, SKU, barcode; Enter takes
  the first hit), "Каталог" (catalogue filters, multi-select), "Нов продукт" (name, sale price, category,
  "Без етикет"; active at once, no stock). Supplier and cost fill in from the product's last delivery
  line, else from "Източник" and the catalogue cost; header defaults for supplier and invoice no. apply
  to new lines. Plan per store under each line ("Равно по всички", rest → Офис). Autosave 1.2 s after
  an edit, paused while a line is incomplete. "Запиши доставката" → `save_delivery` (number, Очаква се).
  "Изтрий черновата" → `cancel_delivery` (kept in Отказани with its log).
- `/deliveries/[id]` once saved — Редове (status per line from its counters), Дневник (append-only log,
  who and when), Проблеми (signals; resolving them is phase 3). "План" per line → `update_plan`.
  "Откажи" → `cancel_delivery`.
- `/deliveries/[id]/receive` — checklist: tick = everything still expected arrived; "Не е наред" →
  Частично (N came, rest still expected, no signal) / По-малко (N came, rest will not, signal) /
  Повредено (N usable go in, signal) / Грешен продукт / Липсва изцяло (nothing in, signal) /
  Друго (N, note required, signal). No "tick all". "Подписвам" shows name, time and
  "N реда, M бр., K проблема", then `receive_delivery_checked`.
- Settings → Доставчици: add, rename, switch off (never delete).

## API (all behind `deliveriesGate`: 401 / 403 seller or deactivated / 404 switch off; zod on input)

`POST /api/deliveries/draft`, `POST /api/deliveries/[id]/save`, `POST /api/deliveries/[id]/receive`,
`POST /api/deliveries/[id]/cancel`, `PATCH /api/deliveries/[id]/items/[itemId]/plan`,
`GET /api/deliveries/products/search`, `GET /api/deliveries/products/catalog`,
`POST /api/deliveries/products`, `GET/POST /api/suppliers`, `PATCH /api/suppliers/[id]`.
Reads on the pages use the admin's own session (RLS admin read policies from phase 1).

## Decisions (Владимир, 11.11)

- Receiving sets `products.cost_price` to the line's unit cost incl. VAT (as phase 1 already does).

## Not in phase 2

Labelling checklist, "За работа", trips/shipments, print, driver signature, store checklist,
resolving signals ("Проблеми"), closing a line's remainder, Excel import, duplicate-invoice warning.
