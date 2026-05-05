# ProductForm Redesign & Auto-Fetch Fix

**Status:** approved
**Date:** 2026-05-06

## Goal

Fix auto-fetch to properly extract price, description, and images from URLs (with AI Bulgarian rewrite), reorganize the form layout to be more compact with less scrolling, and integrate AI description settings into the admin settings page.

## Current Problems

1. **Auto-fetch API** (`/api/fetch-product`) returns `{ title, image, price }` but the client-side handler only uses `title` and `price` — ignores `image`. No `description` extraction at all.
2. **Form layout** is a single vertical column of ~15 fields spanning 500+ lines — too much scrolling, no visual grouping.
3. **Labels page** (`/admin/labels`) is a standalone printing tool disconnected from actual products — user wants AI-generated descriptions instead, with configurable instructions per product.

## Architecture

Three new/updated API endpoints handle the server-side work. The ProductForm gets a compact 3-column layout. AI description rewriting is a separate endpoint callable on demand. Settings page gets a new field for AI instructions.

**Files to create:**
- `src/app/api/fetch-images/route.ts` — download external images to Supabase storage
- `src/app/api/ai/rewrite/route.ts` — AI description rewrite
- `src/app/api/settings/ai-instructions/route.ts` — get/set AI instructions

**Files to modify:**
- `src/app/api/fetch-product/route.ts` — add description extraction, return image array
- `src/components/products/product-form.tsx` — compact layout, use all API data, AI button
- `src/app/(admin)/settings/page.tsx` — add AI instructions field

**Files NOT modified (no auth changes):**
- `src/app/auth/*`
- `src/lib/auth.ts`
- `src/lib/supabase/*`
- `src/components/sales/*`

## Features

### 1. Enhanced Auto-Fetch API

`POST /api/fetch-product` now returns:

```json
{
  "title": "...",
  "description": "...",
  "images": ["url1", "url2"],
  "price": 12.99
}
```

Description extraction order:
1. `og:description` meta
2. `meta[name="description"]`
3. First meaningful paragraph from page body

Image extraction: `og:image` + any images found in JSON-LD product data.

Price extraction (unchanged): `product:price:amount` meta → JSON-LD `"price"` field.

### 2. Image Download Endpoint

`POST /api/fetch-images` receives `{ urls: string[] }`, downloads each image, uploads to Supabase storage `products/` bucket, returns `{ images: [{ url: string, path: string }] }`.

This ensures images are stored in Supabase and won't disappear if the source URL goes down.

### 3. AI Description Rewrite

`POST /api/ai/rewrite` receives `{ description: string, instructions?: string }`, calls AI to rewrite the description in good Bulgarian. Returns `{ description: string }`.

AI model: DeepSeek API via fetch (no new dependencies). Prompt: system message with user's instructions, user message with original description text.

### 4. AI Instructions in Settings

A textarea field added to `/settings` page under a new section "AI Настройки". Stored as a new column `ai_description_instructions` (text, nullable) on the `users` table. Requires a migration: `alter table public.users add column ai_description_instructions text;`.

GET: reads from current user's record. POST: updates current user's record. Via `/api/settings/ai-instructions`.

### 5. Compact Form Layout

**Before:** Single column, ~15 fields stacked, separate auto-fetch box at top.

**After:** 3-column grid where appropriate, URL + fetch integrated into source field, AI button inline near description.

```
Row 1: [Име *] — full width
Row 2: [Цена *] [Доставна цена] [Категория]
Row 3: [SKU] [Баркод] [Статус]
Row 4: [Източник] [URL на източник] [Издърпай]
Row 5: [Описание (textarea)] — full width, [Пренапиши с AI] button above-right
Row 6: [Снимки] — thumbnail grid + upload button
Row 7: [Запази] [Отказ]
```

Hidden fields moved to expandable "Още детайли" section:
- Дата на поръчка
- Наличност

### Data Flow

```
User pastes URL → clicks "Издърпай"
  → POST /api/fetch-product → returns { title, description, images[], price }
  → Form fields populated (name, price, description)
  → POST /api/fetch-images { urls } → images uploaded to Supabase storage
  → Thumbnails appear in the form

User clicks "Пренапиши с AI"
  → POST /api/ai/rewrite { description, instructions } → rewritten description
  → Description field updated

User clicks "Запази"
  → Product inserted/updated in Supabase (existing logic)
  → Images associated with product (existing logic)
```

### Error Handling

- Fetch-product: timeout after 10s, graceful error message in Bulgarian
- Fetch-images: per-image errors don't block other images, partial success
- AI rewrite: error shows toast, original description preserved
- All errors displayed inline in Bulgarian

### Constraints

- No changes to auth system
- No changes to Supabase RLS or schema
- No new npm dependencies (use existing project deps)
- Bulgarian language for all UI text and AI output
