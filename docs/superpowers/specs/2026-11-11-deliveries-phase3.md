# Доставки — фаза 3: етикетиране, курс, пратки, магазин, проблеми

Builds on phase 1 (`2026-11-10-deliveries-phase1-db.md`, PR #5) and phase 2 (`2026-11-11-deliveries-phase2.md`, PR #6).
Plan: Claude Doc "План: Доставки в Prody". Phases 2 and 3 go to production together, behind `DELIVERIES_ENABLED`.

## Database (migration `20261111_deliveries_label_pack_trip.sql`, additive)

The stock functions are from phase 1 (`mark_ready`, `create_trip`, `pack_shipment`, `send_trip`,
`confirm_shipment`, `raise_signal`, `resolve_signal`). Phase 3 adds the signed checklists around them and a way
to take back a trip:

- `mark_ready_checked(p_user, p_rows, p_signals)` — the "Етикетиране" checklist: label signals (the note names the
  store) then `mark_ready`, one transaction.
- `pack_shipment_checked(p_shipment_id, p_user, p_lines, p_box_count, p_signals)` — every line ticked or marked;
  pack signals, `pack_shipment`, then the signalled lines' missing units stop counting as ready (`mark_ready` −n),
  so the next trip does not take them again and they show in "Етикетиране".
- `cancel_trip(p_trip_id, p_user, p_reason)` — only an `open` trip: shipments → `cancelled`, their lines removed,
  trip → `cancelled` (+ `cancelled_at/by`, `cancel_reason`), event `cancelled` with what the shipments held.
  No stock moves (an open trip has taken nothing out of Офис).
- Schema: `trips_status_check` and `shipments_status_check` gain `cancelled` (new, empty tables in prod).
- All three service_role only. Tests: `supabase/tests/deliveries_phase3.test.sql` (staging, rolled back).

## Screens (admin, behind the switch; one row of tabs: Доставки · За работа · Етикетиране · Курсове · Проблеми)

- `/deliveries/work` — "За работа": to receive, to label, ready per store and open trips, shipments waiting for a
  store (amber after 3 days), open problems.
- `/deliveries/labels` — checklist of "product → store, N бр." rows from every open delivery. N = planned − ready,
  at most what was received and not labelled. Rows of one product share the received units; ticking more than that
  is blocked until one row is marked "Частично". "Не е наред": Частично (no signal) / Повредено / Грешен етикет /
  Липсва в Офис / Друго. "Етикет" opens the existing "Етикети" page with name and price.
- `/deliveries/trips` — "Нов курс": tick the stores ("готови 5 реда, 86 бр., от 5 доставки"), one shipment per store
  with everything ready now (`create_trip`). List of trips (В ход / Всички).
- `/deliveries/trips/[id]` — shipments by store, "Опаковай" per shipment, "Шофьорът подписва", "Откажи курса",
  "Лист за курса" and "Печат" per shipment, "Приеми вместо обекта" for a sent shipment.
- `/deliveries/shipments/[id]/pack` — packing checklist; box count; sign → `pack_shipment_checked`.
- Driver: picks their name and types **their own password** on the screen in Офис. The server checks it against
  Supabase Auth with a throw-away client (no cookie; the session it opens is closed with scope `local`), then
  `send_trip(p_driver = driver)`. The admin at the keyboard is in the audit log.
- `/print/trip/[id]` (outside the admin layout) — one page per store: product, delivery number, price, quantity,
  tick box, signature lines (Опаковал, Шофьор, Приел). `?shipment=` prints one.
- `/deliveries/problems` — all signals (Отворени / Всички) with step, product, delivery, shipment → store, numbers,
  who raised it and who signed along the way; "Реши" → decision + note + signature (`resolve_signal`). Decisions
  per step: receive (Няма да дойде / Оправено / Друго), store (Намерено в обекта → units back / Липсата се
  потвърждава / Друго), label and pack (Намерено / Оправено / Друго). Also on the delivery's "Проблеми" tab.
- Menu: red count of open problems beside "Доставки".

## Stores (sellers)

- "Пратки" in the seller menu while the switch is on for anyone (`deliveriesActive`: `all`, an e-mail list, or
  unset in preview/dev), with a count of shipments waiting. `/my-shipments` lists the store's shipments that left
  Офис; `/my-shipments/[id]` is the store checklist (Получено, or По-малко / Повредено / Грешен продукт / Липсва
  изцяло / Друго). Read with the seller's session (RLS: own store only). `POST /api/shipments/[id]/confirm`
  → `confirm_shipment`, which allows only a user of that store or an admin.

## API

`POST /api/deliveries/ready`, `POST /api/deliveries/trips`, `POST /api/deliveries/trips/[id]/cancel`,
`POST /api/deliveries/trips/[id]/send`, `POST /api/deliveries/shipments/[id]/pack`,
`POST /api/deliveries/signals/[id]/resolve` (all behind `deliveriesGate`), `POST /api/shipments/[id]/confirm`
(any active account; switch on).

## Not in phase 3

Correcting "ready" downwards by hand (only through packing signals), taking one store out of an open trip
(cancel the trip and make a new one), barcode scanning on the checklists, photos on signals, label templates.
