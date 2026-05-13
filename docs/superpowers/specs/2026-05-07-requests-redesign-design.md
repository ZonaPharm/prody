# Requests Redesign — Admin & Seller

## Goal
Redesign the request system UI so admin can see at a glance who ordered what, when, and with what status. Seller gets clear comment fields when submitting and confirming. Full status timeline visible for each request.

## Architecture
- **Admin panel:** Cards grouped by batch (store + timestamp), with expandable product list, status timeline, and action buttons. Pending and processed sections clearly separated.
- **Seller panel:** Cart with prominent optional comment field. Confirm dialog with qty +/- controls and optional comment. Request history with clickable rows for timeline.
- **API:** Batch endpoint already exists (`request-batch`). Events endpoint already exists (fallback to derived timeline). Confirm endpoint already accepts notes and received_qty.
- **No new endpoints needed.** Changes are UI-only: better layout, clearer colors, visible comment fields, timeline integration.

## Tech Stack
- Next.js + React + Tailwind CSS + shadcn/ui (existing)
- No new dependencies

## Design

### Admin Requests Page

Page layout:
- Header: "Заявки за зареждане" + count summary (X чакащи · Y обработени)
- Section: **Чакащи** with amber header
- Section: **Обработени** with muted header

Each batch card (same store + same created_at second):
- **Header row:** store icon + store name + status badge (colored) + relative time ("преди 2 часа")
- **Comment row:** if notes exist, show 💬 icon + comment text (not truncated)
- **Summary:** 📦 N продукта · общо X броя
- **Expand toggle:** click card header to expand/collapse product list
- **Expanded:** list of products with qty, each with individual ✔ (fulfill single) button
- **Footer:** "Прехвърли всички" button (opens fulfill dialog)

Status colors:
- pending: amber/yellow badge
- fulfilled: blue badge ("Изпратена")
- confirmed: green badge ("Потвърдена")  
- partial: orange badge ("Частична")

**Fulfill dialog (per store batch):**
- Shows all products in batch with requested qty
- For each product: list of source stores with available stock + qty input
- "Прехвърли" button processes all transfers + marks requests fulfilled

**Detail dialog (click on product in history):**
- Product name, requested qty, store name
- Timeline: vertical line with colored dots per status event
- Each event: status label, notes, timestamp

### Seller Requests Page

**Cart panel (visible when cart has items):**
- Product list with images, names, prices, qty controls
- **Comment field:** full-width input with 💬 icon placeholder "Коментар към заявката (по желание)"
- Total count
- Submit button: "📤 Изпрати заявка"

**Confirm dialog:**
- Product name, requested qty
- Received qty: [−] [+] controls + "Всички" shortcut button
- Warning text when partial: "Ще бъде частично (X от Y бр.)"
- **Comment field:** full-width input "Коментар (по желание)"
- Actions: "Отказ" / "Потвърди получаването"

**History table:**
- Columns: Продукт, Кол., Статус, Дата, Действие
- Clickable rows open detail dialog with timeline
- Fulfilled rows show "Потвърди" button

## Data Flow
1. Seller adds products → cart with optional comment
2. Submit → `POST /api/inventory/request-batch` with `{items, store_id, notes}`
3. All items get same `created_at` for batch grouping
4. Admin opens requests → grouped by `(store_id, created_at, notes)`
5. Admin transfers stock → individual transfers via `/api/inventory/transfer` + fulfill via `/api/inventory/requests/:id/fulfill`
6. Seller confirms → `POST /api/inventory/requests/:id/confirm` with `{received_qty, notes}`
7. Status events logged via `request_events` table (or derived if table missing)

## Scope
- UI-only changes to `requests-client.tsx` and `low-stock-client.tsx`
- No new API endpoints needed
- No database changes needed (request_events migration already exists)
