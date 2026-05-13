# Excel Export Reports — Design Spec

## Goal
Add 3 Excel export options to the reports page: by store, by product, and full detail. Existing charts/KPIs remain untouched. New export section appears below existing content.

## Architecture
- **Client:** Reports page gets an "Експорт" section with date picker, optional store dropdown, and 3 export cards
- **API:** New `POST /api/reports/export` endpoint takes `{type, from, to, store_id}` and returns `.xlsx` file
- **Library:** `xlsx` (SheetJS) for generating real Excel files with formatting, auto-filters, and proper Bulgarian charset
- **No DB changes** — all data comes from existing `sales` table with joins to `products`, `stores`, `categories`

## Tech Stack
- Next.js 16 + React + Tailwind CSS + shadcn/ui (existing)
- `xlsx` npm package (new dependency)

## Design

### Reports Page Layout
Existing page stays exactly as-is. A new `<Card>` section is added at the bottom:

```
┌─ Съществуващи KPI карти ───────────────────────────────┐
│ Общо оборот | Брой продажби | Уникални продукти | Ниски │
├─ Съществуващи графики ─────────────────────────────────┤
│ Revenue by day (BarChart) | Top products (HorizontalBar)│
├─ Съществуващи ниски наличности ────────────────────────┤
│ Low stock list                                         │
├─ НОВО: Експорт секция ─────────────────────────────────┤
│                                                        │
│ Период: [От дата] - [До дата]   Магазин: [Всички  ▼]  │
│                                                        │
│ [📊 По обекти]  [📦 По продукти]  [📋 Пълен детайл]   │
│  Оборот/брой     К-во/сума по     Всяка продажба       │
│  по магазин      продукт          като ред             │
│  [Excel .xlsx]   [Excel .xlsx]    [Excel .xlsx]        │
└────────────────────────────────────────────────────────┘
```

### Export Types

**1. Store Report (по обекти)**
Columns: Обект | Брой продажби | Оборот (€) | Кеш (€) | Карта (€)
- Groups sales by store for the period
- Shows revenue split by payment method
- Auto-filter, bold headers, formatted numbers

**2. Product Report (по продукти)**
Columns: Продукт | Категория | Продадени бр. | Оборот (€) | Обекти
- Groups sales by product (optionally filtered by store)
- Shows total qty, revenue, and number of stores that sold it
- Auto-filter, bold headers, formatted numbers

**3. Full Detail (пълен детайл)**
Columns: Дата | Обект | Продукт | Категория | К-во | Цена (€) | Сума (€) | Плащане | Продавач
- Every individual sale as a row
- All columns formatted
- Auto-filter, bold headers, date formatted bg-BG

### API Design

`POST /api/reports/export`
```json
{
  "type": "store" | "product" | "detail",
  "from": "2026-05-01",
  "to": "2026-05-07",
  "store_id": null  // optional filter
}
```
Returns: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` binary

### File Structure
- Modify: `src/app/(admin)/reports/page.tsx` — add export section
- Create: `src/app/api/reports/export/route.ts` — single export endpoint
- Create: `src/lib/export-reports.ts` — Excel generation helpers (column widths, formatting, sheet creation)
- Install: `xlsx` npm package

## Scope
- Reports page gets export section below existing content
- No changes to existing charts, KPIs, or low-stock section
- Single API endpoint handles all 3 export types
- Excel files with proper formatting, auto-filters, Bulgarian charset
