# Request Workflow Redesign — Design Spec

**Date:** 2026-05-13
**Status:** Approved

## Overview

Redesign the stock request system with clearer statuses, comments, better UX (split panel for admin, tabs for seller), and proper audit trail.

## Data Model

### `stock_requests` — new columns (all nullable, no default)

| Column | Type | Purpose |
|---|---|---|
| `accepted_at` | timestamptz | When admin accepted |
| `in_transit_at` | timestamptz | When admin shipped after transfer |
| `delivered_at` | timestamptz | When arrived at store |
Existing `fulfilled_at`, `fulfilled_by` columns preserved — old requests keep working. Transfer source tracking is handled by `stock_movements` entries (one per transfer).

### New table: `request_notes`

| Column | Type |
|---|---|
| `id` | uuid PK |
| `request_id` | uuid → stock_requests NOT NULL |
| `user_id` | uuid → auth.users NOT NULL |
| `user_name` | text |
| `body` | text NOT NULL |
| `created_at` | timestamptz NOT NULL DEFAULT now() |

Index: `request_id, created_at`.

### New table: `request_events` (create if missing)

| Column | Type |
|---|---|
| `id` | uuid PK |
| `request_id` | uuid → stock_requests NOT NULL |
| `status` | text NOT NULL |
| `user_id` | uuid → auth.users NOT NULL |
| `notes` | text |
| `meta` | jsonb |
| `created_at` | timestamptz NOT NULL DEFAULT now() |

Index: `request_id, created_at`.

## Statuses

```
pending → accepted → in_transit → delivered → confirmed
  └───────── rejected
```

| Status | Who sets it | Meaning |
|---|---|---|
| `pending` | Seller (create) | Waiting for admin review |
| `accepted` | Admin | Reviewed, preparing to fulfill |
| `in_transit` | Admin | Stock transferred, en route to store |
| `delivered` | Admin | Arrived at store, waiting seller check |
| `confirmed` | Seller | Verified and confirmed (terminal) |
| `rejected` | Either | Declined (terminal) |

### Backwards compatibility
- Old `fulfilled` status maps to `confirmed` visually
- Old `partial` treated as `confirmed` with partial flag
- Old `pending` unchanged
- New statuses only for new request flow

## API Endpoints

### New / Modified

| Endpoint | Method | Role | Action |
|---|---|---|---|
| `/api/inventory/requests/[id]/accept` | POST | admin | pending → accepted |
| `/api/inventory/requests/[id]/ship` | POST | admin | accepted → in_transit (after transfers) |
| `/api/inventory/requests/[id]/deliver` | POST | admin | in_transit → delivered |
| `/api/inventory/requests/[id]/notes` | GET | both | List comments |
| `/api/inventory/requests/[id]/notes` | POST | both | Add comment |

### Existing (modified)

| Endpoint | Changes |
|---|---|
| `/api/inventory/request-batch` | No changes (grouping via shared `created_at`) |
| `/api/inventory/requests/[id]/fulfill` | Deprecate — replaced by accept + ship |
| `/api/inventory/requests/[id]/confirm` | Keep, seller confirms receipt |
| `/api/inventory/requests/[id]/reject` | Fix: use admin client, proper event logging |
| `/api/inventory/requests/[id]/events` | Use real `request_events` table |
| `/api/inventory/requests` | Support new status filter |

## UI Design

### Seller: "Заявки" page with 2 tabs

**Tab "Заяви":**
- Product search input
- List of all active products with: name, current stock, price
- Quantity input + optional note per product
- "Добави" button → adds to request basket
- Request basket: list of products to request with qty
- "Изпрати заявка" → creates batch request

**Tab "Моите заявки":**
- List of request batches, grouped
- Each batch shows: status badge, products, qty, date, comments
- Timeline of status changes
- Confirm button when status = `delivered`
- Reject button when status = `pending`

### Admin: "Заявки" page — split panel

**Left panel (1/3):**
- List of pending batches, grouped by store×time
- Badge with count
- Click to select → loads in right panel
- Filter tabs: Pending | In Progress | Done

**Right panel (2/3):**
- Selected batch detail:
  - Products list with requested qty
  - Stock availability per store/warehouse
  - Transfer quantities input
  - Source store selector
  - Action buttons based on status
- Comments timeline
- Status timeline (from request_events)

**Quick action buttons (admin):**
- `pending`: [Приеми] [Откажи]
- `accepted`: [Прехвърли и изпрати] — opens transfer dialog, then marks in_transit
- `in_transit`: [Маркирай като доставена]
- `delivered`: informational — waiting for seller
- `confirmed` / `rejected`: archived

## Migration Plan

Three reversible steps:

1. **Migration SQL** — create `request_notes`, `request_events` tables; add nullable columns to `stock_requests`
2. **API changes** — new endpoints, fix existing bugs (reject RLS, event logging)
3. **UI changes** — seller tabs, admin split panel, status badges, comment timeline

Deploy each step separately. Old requests continue working throughout.

## Notes

- `request_events` is the automated audit log (one row per status change)
- `request_notes` is for human-readable comments between seller and admin
- Both admin and seller can write notes
- Old `stock_requests.notes` field preserved — contains legacy timeline data
- New notes go into `request_notes` table
- Transfer creates proper `stock_movements` entries for both source and destination
