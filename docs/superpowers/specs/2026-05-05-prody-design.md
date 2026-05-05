# Prody — Design Spec

## Overview

Prody is a cloud-based web application for a small retail business that:
1. Manages product inventory — from ordering (Temu, AliExpress, etc.) to catalog
2. Tracks sales across multiple physical stores
3. Generates reports on sales, stock, and trends

**Stack:** Next.js (React, TypeScript, Tailwind CSS, Shadcn/ui) + Supabase (PostgreSQL, Auth, Storage) hosted on Vercel.

**Timeline:** 1-2 months for first full version.

## Users & Roles

3-5 total users, two roles:

| Role | Access | Primary Screens |
|------|--------|-----------------|
| Admin | Full access to everything | Dashboard, Catalog, Sales, Reports, Settings |
| Seller | Own store only | Record Sale, My Sales, Catalog (read-only) |

Authentication via Supabase Auth (magic link). Roles stored in `public.users` table. Row-Level Security enforces data access per role.

## Architecture

```
Browser → Next.js (Vercel) → Supabase
                                  ├── PostgreSQL (data)
                                  ├── Auth (login, RLS)
                                  └── Storage (product images)
```

- **Frontend:** Next.js App Router, server-rendered pages, client components for interactivity
- **API:** Next.js API routes for custom logic (auto-fetch from links, label generation, reports)
- **Auth:** Supabase Auth with Row-Level Security — DB policies enforce that sellers see only their store's data
- **Storage:** Supabase Storage for product images

## Data Model

### Product
```
id, name, description, price, cost_price, sku, barcode
category_id → Category
source, source_url, source_order_date
status: ordered | received | damaged | returned | listed
quantity_on_hand
created_at, updated_at
```

### Category
```
id, name, description
parent_id → Category (self-referencing, for subcategories)
sort_order
```

### Store
```
id, name, address, is_active
```

### Sale
```
id, product_id → Product, store_id → Store
sold_by → User, quantity, sale_price, sale_date
notes
created_at
```

### ProductImage
```
id, product_id → Product
url (Supabase Storage)
is_primary, sort_order
```

### User (extends Supabase Auth)
```
id, email, role: admin | seller
display_name, store_id → Store
```

## Screen Structure

### Admin (6 screens)

1. **Dashboard** — Summary cards (total products, stock, ordered, sales today/week), low stock alerts, pending deliveries, quick actions
2. **Catalog** — Product table/grid with search, category filters, status filters, sorting. Buttons: Add Product, Generate Label. Click → detail.
3. **Add/Edit Product** — Form with name, description, prices, category, status, source info, quantities. Image upload (drag & drop). Link field for auto-fetch.
4. **Sales** — All sales across stores, filters by store/date/product, grouped views
5. **Reports** — Top products, sales by store/category, trends (chart), low-stock reorder suggestions
6. **Settings** — Manage categories, stores, users (invite)

### Seller (3 screens)

1. **Record Sale** (primary screen) — Fast search → select product → enter quantity → confirm. Shows product image and price. Sub-5-second workflow. Optional manual price override.
2. **My Sales** — Today's sales summary, filter by date
3. **Catalog** — Read-only product list with search and category browsing. "Record Sale" button from here.

## Key Features

### Product Auto-Fetch from Link
- Paste link (Temu, AliExpress, etc.) in product form
- Backend fetches the page, extracts title, image, price from meta tags / structured data
- Best-effort — results vary by site; user always edits before saving
- Separate API route: `POST /api/fetch-product`

### Label Maker
- Standalone tool — not tied to a product
- Enter title + description text
- Choose label size (default 5×3 cm)
- Generates a print-formatted page
- Browser print dialog to print on adhesive paper

### Search
- Full-text search across product name, description, SKU
- Filterable by category, status, price range
- Instant results as you type (debounced)

### Reports
- Top-selling products by period (day/week/month/custom)
- Sales breakdown by store
- Sales breakdown by category
- Trend chart (sales over time)
- Low-stock reorder suggestions

## Error Handling

- Form validation before submit — field-level error messages
- Network errors show retry option
- Auto-fetch failures show partial results + manual entry option
- Optimistic UI where appropriate with rollback on failure

## Testing Strategy

- TypeScript for type safety across the stack
- Unit tests: business logic (price calculations, validations, label formatting)
- Integration tests: API routes
- E2E: core flow (add product → record sale → view report)

## Out of Scope for MVP

- Direct thermal printer integration
- Offline mode / sync
- Profit margin calculations and financial forecasting
- Barcode scanner integration
- Bulk product import
- Customer database
