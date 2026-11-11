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

## Labelling per delivery line (migration `20261111_deliveries_label_items.sql`)

Decided by Владимир on 11.11: every received unit gets a label, also the units that stay in
Офис (Офис sells online). So "Етикетиране" is per delivery line, not per "product → store":

- `delivery_items.labelled_qty` (+ generated `unlabelled_qty = received − labelled`). Products
  "Без етикет" count as labelled when received (trigger). A trigger keeps
  `labelled_qty ≥ Σ ready_qty`, so the older `mark_ready` paths stay consistent.
- `label_items_checked(p_user, p_rows [{item_id, qty}], p_signals [{item_id, …}])` labels units
  and calls `_auto_ready_item`: labelled units nobody has yet go to the plan rows still short
  of ready units, in store-name order; the rest stay labelled in Офис. Allowed on any delivery
  that is not a draft or cancelled, so Офис units can be labelled after the stores have theirs.
- `update_plan` (replaced): a row may go below its ready units, down to shipped + on a trip
  that has not left; the freed labelled units go to other stores. Then `_auto_ready_item`.
- `pack_shipment_checked` (replaced): units missing at packing are also un-labelled.
- Completion of a delivery is unchanged; Офис units without a label stay in "Етикетиране".
- Event type `labelled`. Tests: `supabase/tests/deliveries_label_items.test.sql`; T7 of
  `deliveries.test.sql` updated to the new plan rule.
- Restore note in `docs/BACKUP-RESTORE.md` (generated column, triggers).

`mark_ready_checked` from the first migration stays in the database but the app no longer calls it.

## Screens (admin, behind the switch; one row of tabs: Доставки · За работа · Етикетиране · Курсове · Проблеми)

- `/deliveries/work` — "За работа": to receive, to label, ready per store and open trips, shipments waiting for a
  store (amber after 3 days), open problems.
- `/deliveries/labels` — checklist of delivery lines with received units still without a label: "Крем, 20 бр. →
  Ботев 10 · Офис 10". `?delivery=` filters one delivery. "Не е наред": Частично (no signal) / Повредено / Грешен
  етикет / Липсва в Офис / Друго. "Етикет" opens the existing "Етикети" page with name and price.
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

## Печат на етикети (A4, предварително нарязани листове)

- От „Етикетиране“: бутон „Печат на етикетите“ (всички показани редове) и „Етикет“ на всеки ред.
  Отварят `/print/labels?items=<id на редовете>` в нов раздел, без да минават през менюто „Етикети“.
- Етикет, всичко центрирано: името на продукта с удебелен шрифт, под него описанието
  (`products.description`, ако е празно `wp_short_description`, без HTML), после баркодът (Code128 от
  `barcode`, ако го няма от `sku`; без баркод, ако няма и двете) и цената под баркода. Размерът на
  шрифта следва размера на етикета; описанието се реже на толкова реда, колкото се събират.
- Готовите размери са листовете Office1, които се ползват: 24 (70 × 37), 40 (52,5 × 29,7),
  44 (48,5 × 25,4) и 65 (38,1 × 21,2 мм) на лист.
- Броят на ред започва от бройките без етикет и се променя на страницата. Листът се избира от готови
  размери или се задава ръчно (колони, редове, размер, полета, разстояния, в мм) и се помни в браузъра.
  „Започни от етикет №“ ползва започнат лист. Печат при полета „Няма“ и мащаб 100 %.
- Печатът не отбелязва нищо: етикетирането се подписва в „Етикетиране“, както досега.
- Профили на хартията (таблица `label_sheet_profiles`, миграция `20261111_label_sheet_profiles.sql`):
  „Запази като нов профил“ пази текущите числа под име, общо за всички компютри; запазен профил
  може да се променя и изтрива. Вградените листове Office1 не се променят, от тях се прави нов профил.
  „Отместване на целия печат“ (надясно/надолу, от −20 до 20 мм) мести всичко за принтер, който печата
  разместено. Докато миграцията не е пусната, страницата работи само с вградените листове.

## Етикетиране на част от реда (11.11, вечер)

- Отпечатването на етикети не отбелязва нищо. Ред е етикетиран, когато някой подпише, че бройките са
  преопаковани (ако трябва) и с налепен етикет. Изречението при подпис: „Тези бройки са преопаковани,
  където трябва, и са с етикет.“
- „Само част“ на реда: колко са готови сега и къде отиват. Изборът е в рамките на първоначалния план:
  магазин до това, което още му трябва (planned − ready), Офис до своя дял, още неетикетиран
  (received − Σ planned − етикетираните, които никой магазин няма). Започва с магазините по име, после Офис.
- Базата: `label_items_checked` приема `split = [{store_id, qty}]` (store_id null = Офис) на ред
  (миграция `20261111_deliveries_label_split.sql`, тестове `deliveries_label_split.test.sql`). Частите за
  магазини са готови веднага; частта за Офис остава етикетирана в Офис. Ред без split работи както преди.
- Кой потвърждава: засега админите. Служителите на Офис ще получат достъп при почистването на
  потребителите и достъпите (по-късно, по думите на Владимир).
