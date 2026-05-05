# ProductForm Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix auto-fetch to extract description + images from URLs, add AI Bulgarian rewrite, and reorganize ProductForm into compact 3-column layout.

**Architecture:** Three new API routes handle server-side work (fetch-product enhanced, fetch-images for storage upload, ai/rewrite for description). ProductForm gets compact grid layout. Settings page gets new AI tab for instructions. Migration adds column to users table.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase JS client + storage, DeepSeek API via fetch, Tailwind CSS, Radix UI Select.

**Note:** Project has no test framework. Manual testing via `curl` for APIs, browser for UI.

---

## Task 1: Database Migration — AI Instructions Column

**Files:**
- Create: `supabase/migrations/00002_ai_instructions.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Add AI description instructions column to users table
alter table public.users add column if not exists ai_description_instructions text;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with project_id from `.env.local`, name: `00002_ai_instructions`, query: the SQL above.

- [ ] **Step 3: Verify column exists**

Use `mcp__claude_ai_Supabase__execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'users' and column_name = 'ai_description_instructions';
```
Expected: one row returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00002_ai_instructions.sql
git commit -m "feat: add ai_description_instructions column to users"
```

---

## Task 2: Enhanced Fetch-Product API

**Files:**
- Modify: `src/app/api/fetch-product/route.ts` — full rewrite

- [ ] **Step 1: Replace fetch-product route with enhanced version**

```typescript
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const url = body.url

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL е задължително поле' }, { status: 400 })
    }

    let parsed: URL
    try { parsed = new URL(url) } catch {
      return NextResponse.json({ error: 'Невалиден URL адрес' }, { status: 422 })
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Позволени са само http и https адреси' }, { status: 422 })
    }

    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Prody/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Страницата върна статус ${response.status}` },
        { status: 422 }
      )
    }

    const html = await response.text()

    const getMeta = (property: string): string | null => {
      const regex = new RegExp(
        `<meta[^>]+property=["']${escapeRegex(property)}["'][^>]+content=["']([^"']*)["']`,
        'i'
      )
      const match = html.match(regex)
      return match ? match[1] : null
    }

    const getMetaName = (name: string): string | null => {
      const regex = new RegExp(
        `<meta[^>]+name=["']${escapeRegex(name)}["'][^>]+content=["']([^"']*)["']`,
        'i'
      )
      const match = html.match(regex)
      return match ? match[1] : null
    }

    // Title
    const title =
      getMeta('og:title') ||
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
      null

    // Description
    const description =
      getMeta('og:description') ||
      getMetaName('description') ||
      null

    // Images
    const images: string[] = []
    const ogImage = getMeta('og:image')
    if (ogImage) images.push(ogImage)

    // Parse JSON-LD for additional images
    const jsonLdMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const inner = match.replace(/<[^>]+>/g, '')
          const data = JSON.parse(inner)
          const product = data['@graph']?.find?.((g: any) => g['@type'] === 'Product') || 
                         (data['@type'] === 'Product' ? data : null)
          if (product?.image) {
            const imgs = Array.isArray(product.image) ? product.image : [product.image]
            for (const img of imgs) {
              if (typeof img === 'string' && !images.includes(img)) images.push(img)
              if (typeof img === 'object' && img.url && !images.includes(img.url)) images.push(img.url)
            }
          }
        } catch { /* skip invalid JSON-LD */ }
      }
    }

    // Price
    let price: number | null = null
    const ogPrice = getMeta('product:price:amount')
    if (ogPrice) {
      const parsedPrice = parseFloat(ogPrice)
      if (!isNaN(parsedPrice)) price = parsedPrice
    }
    if (price === null) {
      const priceMatch = html.match(/"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/)
      if (priceMatch) {
        const parsedPrice = parseFloat(priceMatch[1])
        if (!isNaN(parsedPrice)) price = parsedPrice
      }
    }

    return NextResponse.json({ title, description, images, price })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Неуспешно извличане' },
      { status: 422 }
    )
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

- [ ] **Step 2: Test with curl**

```bash
curl -X POST http://localhost:3000/api/fetch-product \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/product-page"}'
```
Expected: JSON with `{ title, description, images, price }`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/fetch-product/route.ts
git commit -m "feat: add description and images extraction to fetch-product API"
```

---

## Task 3: Settings AI Instructions API

**Files:**
- Create: `src/app/api/settings/ai-instructions/route.ts`

- [ ] **Step 1: Create the API route**

```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('users')
    .select('ai_description_instructions')
    .eq('id', user.id)
    .single()

  return NextResponse.json({ instructions: data?.ai_description_instructions || '' })
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { instructions } = await request.json()

  const { error } = await supabase
    .from('users')
    .update({ ai_description_instructions: instructions })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Test with curl**

```bash
# GET
curl http://localhost:3000/api/settings/ai-instructions
# Expected: { "instructions": "" }

# POST
curl -X POST http://localhost:3000/api/settings/ai-instructions \
  -H 'Content-Type: application/json' \
  -d '{"instructions":"Пиши на професионален български"}'
# Expected: { "success": true }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/ai-instructions/route.ts
git commit -m "feat: add AI instructions settings API"
```

---

## Task 4: AI Rewrite API

**Files:**
- Create: `src/app/api/ai/rewrite/route.ts`

- [ ] **Step 1: Create the AI rewrite API route**

```typescript
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { description, instructions } = await request.json()

    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'Липсва описание' }, { status: 400 })
    }

    const systemPrompt = instructions 
      ? `Ти си професионален редактор на продуктови описания. Следвай тези инструкции:\n${instructions}`
      : 'Ти си професионален редактор на продуктови описания. Пренапиши описанието на добър, професионален български език. Запази цялата фактологична информация. Използвай ясни и точни изрази. Не добавяй информация, която не съществува в оригинала.'

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Пренапиши следното продуктово описание на български:\n\n${description}` },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `AI грешка: ${response.status}` }, { status: 502 })
    }

    const data = await response.json()
    const rewritten = data.choices?.[0]?.message?.content?.trim()

    if (!rewritten) {
      return NextResponse.json({ error: 'AI не върна резултат' }, { status: 502 })
    }

    return NextResponse.json({ description: rewritten })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Грешка при пренаписване' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Add DEEPSEEK_API_KEY to .env.local**

Ensure `.env.local` has: `DEEPSEEK_API_KEY=sk-...`

- [ ] **Step 3: Test with curl**

```bash
curl -X POST http://localhost:3000/api/ai/rewrite \
  -H 'Content-Type: application/json' \
  -d '{"description":"High quality wireless headphones with noise cancellation"}'
```
Expected: `{ "description": "..." }` with Bulgarian text.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/rewrite/route.ts
git commit -m "feat: add AI description rewrite API"
```

---

## Task 5: Fetch-Images API

**Files:**
- Create: `src/app/api/fetch-images/route.ts`

- [ ] **Step 1: Create fetch-images API route**

```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { urls } = await request.json()

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'Няма URL-та на изображения' }, { status: 400 })
    }

    const supabase = await createServerSupabaseClient()
    const results: { url: string; path: string; error?: string }[] = []

    for (const imageUrl of urls) {
      try {
        const imageResponse = await fetch(imageUrl, {
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'Prody/1.0' },
        })

        if (!imageResponse.ok) {
          results.push({ url: imageUrl, path: '', error: `HTTP ${imageResponse.status}` })
          continue
        }

        const contentType = imageResponse.headers.get('content-type') || ''
        if (!contentType.startsWith('image/')) {
          results.push({ url: imageUrl, path: '', error: 'not an image' })
          continue
        }

        const buffer = await imageResponse.arrayBuffer()
        const ext = contentType.split('/')[1] || 'jpg'
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(filename, Buffer.from(buffer), {
            contentType,
            upsert: false,
          })

        if (uploadError) {
          results.push({ url: imageUrl, path: '', error: uploadError.message })
          continue
        }

        const { data: urlData } = supabase.storage
          .from('products')
          .getPublicUrl(filename)

        results.push({ url: urlData.publicUrl, path: filename })
      } catch (err) {
        results.push({
          url: imageUrl,
          path: '',
          error: err instanceof Error ? err.message : 'download failed',
        })
      }
    }

    return NextResponse.json({ images: results })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Грешка при изтегляне на изображения' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Test with curl**

```bash
curl -X POST http://localhost:3000/api/fetch-images \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://picsum.photos/200"]}'
```
Expected: `{ "images": [{ "url": "https://...supabase.../products/...", "path": "..." }] }`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/fetch-images/route.ts
git commit -m "feat: add fetch-images API to download and store images"
```

---

## Task 6: ProductForm Layout Redesign

**Files:**
- Modify: `src/components/products/product-form.tsx` — major rework

- [ ] **Step 1: Rewrite handleAutoFetch to use all API data**

Replace the existing `handleAutoFetch` function with one that:
1. Calls `/api/fetch-product`
2. Sets name, price, description from response
3. Calls `/api/fetch-images` with `data.images`
4. Sets files/images from downloaded results

```typescript
const handleAutoFetch = async () => {
  if (!fetchUrl.trim()) return
  setFetchLoading(true)
  setFetchError('')

  try {
    const res = await fetch('/api/fetch-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fetchUrl.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { setFetchError(data.error || 'Неуспешно извличане'); return }

    if (data.title) setName(data.title)
    if (data.price) setPrice(data.price.toString())
    if (data.description) setDescription(data.description)

    if (data.images?.length > 0) {
      const imgRes = await fetch('/api/fetch-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: data.images }),
      })
      const imgData = await imgRes.json()
      if (imgData.images) {
        const downloadedUrls: string[] = []
        for (const img of imgData.images) {
          if (img.url && !img.error) {
            downloadedUrls.push(img.url)
            setExistingImages(prev => [...prev, {
              id: img.path,
              url: img.url,
              is_primary: prev.length === 0 && downloadedUrls.length === 1,
              sort_order: prev.length + 1,
            }])
          }
        }
      }
    }
  } catch {
    setFetchError('Грешка при извличане на данни')
  } finally {
    setFetchLoading(false)
  }
}
```

- [ ] **Step 2: Add AI rewrite handler**

```typescript
const [rewriteLoading, setRewriteLoading] = useState(false)

const handleAiRewrite = async () => {
  if (!description.trim()) return
  setRewriteLoading(true)
  try {
    const res = await fetch('/api/ai/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description.trim() }),
    })
    const data = await res.json()
    if (!res.ok) { setSubmitError(data.error || 'AI грешка'); return }
    if (data.description) setDescription(data.description)
  } catch {
    setSubmitError('Грешка при свързване с AI')
  } finally {
    setRewriteLoading(false)
  }
}
```

- [ ] **Step 3: Redesign form layout to compact 3-column grid**

Replace the entire JSX return statement. Layout structure:

```tsx
return (
  <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
    {submitError && (
      <div className="rounded-md bg-red-50 border border-red-200 p-4">
        <p className="text-sm text-red-700">{submitError}</p>
      </div>
    )}

    {/* Row 1: Name — full width */}
    <div className="space-y-2">
      <Label htmlFor="name">Име *</Label>
      <Input id="name" required value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Име на продукта" />
    </div>

    {/* Row 2: Price, Cost, Category — 3 columns */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label htmlFor="price">Цена *</Label>
        <Input id="price" type="number" step="0.01" min="0" required
          value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cost_price">Доставна цена</Label>
        <Input id="cost_price" type="number" step="0.01" min="0"
          value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0.00" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="category_id">Категория</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="category_id"><SelectValue placeholder="Избери категория" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Без категория</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>

    {/* Row 3: SKU, Barcode, Status — 3 columns */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label htmlFor="sku">SKU</Label>
        <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-001" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="barcode">Баркод</Label>
        <Input id="barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="1234567890123" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="status">Статус</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>

    {/* Row 4: Source, Source URL + Fetch button — 2 cols */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="source">Източник</Label>
        <Input id="source" value={source}
          onChange={(e) => setSource(e.target.value)} placeholder="Име на доставчик" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="source_url">URL на източник</Label>
        <div className="flex gap-2">
          <Input id="source_url" type="url" className="flex-1"
            value={fetchUrl}
            onChange={(e) => { setFetchUrl(e.target.value); setSourceUrl(e.target.value) }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAutoFetch())}
            placeholder="https://..." />
          <Button type="button" variant="secondary"
            onClick={handleAutoFetch} disabled={fetchLoading || !fetchUrl.trim()}>
            {fetchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Издърпай
          </Button>
        </div>
        {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}
      </div>
    </div>

    {/* Row 5: Description + AI button */}
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="description">Описание</Label>
        <Button type="button" variant="outline" size="sm"
          onClick={handleAiRewrite}
          disabled={rewriteLoading || !description.trim()}>
          {rewriteLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
          Пренапиши с AI
        </Button>
      </div>
      <Textarea id="description" rows={4} value={description}
        onChange={(e) => setDescription(e.target.value)} placeholder="Описание на продукта" />
    </div>

    {/* Row 6: Images */}
    {existingImages.length > 0 && (
      <div className="space-y-2">
        <Label>Текущи снимки</Label>
        <div className="flex flex-wrap gap-3">
          {existingImages.map((img) => (
            <div key={img.id} className="relative group">
              <img src={img.url} alt="" className="h-24 w-24 object-cover rounded-md border" />
              <button type="button" onClick={() => removeExistingImage(img.id)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">x</button>
              {img.is_primary && (
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 rounded-b-md">Основна</span>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="space-y-2">
      <Label>Снимки</Label>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Избери файлове
        </Button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={handleFileChange} />
        <span className="text-sm text-muted-foreground">
          {files.length > 0
            ? `${files.length} избран${files.length === 1 ? '' : 'и'} файл${files.length === 1 ? '' : 'а'}`
            : 'Няма избрани файлове'}
        </span>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="relative group">
              <img src={URL.createObjectURL(file)} alt={file.name} className="h-24 w-24 object-cover rounded-md border" />
              <button type="button" onClick={() => removeFile(i)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">x</button>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Hidden fields kept for data integrity */}
    <input type="hidden" value={sourceUrl} />
    <input type="hidden" value={sourceOrderDate} />
    <input type="hidden" value={quantityOnHand} />

    {/* Submit */}
    <div className="flex items-center gap-3 pt-4 border-t">
      <Button type="submit" disabled={submitLoading}>
        {submitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {submitLoading ? 'Запазва...' : isEdit ? 'Запази промените' : 'Добави продукт'}
      </Button>
      <Button type="button" variant="ghost" onClick={() => router.push('/catalog')}>Отказ</Button>
    </div>
  </form>
)
```

- [ ] **Step 4: Build and verify no TypeScript errors**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Run dev server and test manually**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npm run dev
```

Open `http://localhost:3000/catalog/new`:
- Verify compact 3-column layout
- Paste a URL and click "Издърпай"
- Verify name, price, description, images populate
- Click "Пренапиши с AI" to test AI rewrite
- Save product and verify it appears in catalog

- [ ] **Step 6: Commit**

```bash
git add src/components/products/product-form.tsx
git commit -m "feat: redesign ProductForm with compact layout, auto-fetch images, AI rewrite"
```

---

## Task 7: Settings Page — AI Instructions Field

**Files:**
- Modify: `src/app/(admin)/settings/page.tsx`

- [ ] **Step 1: Create AI instructions client component**

Create inline or as small component. Add a new tab "AI" with a textarea and save button:

```tsx
import { requireAdmin } from '@/lib/auth'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategoriesManager } from './categories-manager'
import { StoresManager } from './stores-manager'
import { AiSettings } from './ai-settings'

export default async function SettingsPage() {
  await requireAdmin()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Настройки</h1>
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Категории</TabsTrigger>
          <TabsTrigger value="stores">Магазини</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>
        <TabsContent value="categories"><CategoriesManager /></TabsContent>
        <TabsContent value="stores"><StoresManager /></TabsContent>
        <TabsContent value="ai"><AiSettings /></TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: Create AiSettings component**

```bash
# Create: src/app/(admin)/settings/ai-settings.tsx
```

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export function AiSettings() {
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/ai-instructions')
      .then(r => r.json())
      .then(d => { if (d.instructions) setInstructions(d.instructions) })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/settings/ai-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions }),
      })
      if (!res.ok) throw new Error('Грешка при запис')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm">Запазено успешно</div>
      )}
      <div className="space-y-2">
        <Label htmlFor="ai-instructions">AI инструкции за пренаписване на описание</Label>
        <Textarea
          id="ai-instructions"
          rows={6}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Пример: Пиши на професионален български. Включи основни характеристики и технически детайли. Избягвай маркетингови фрази."
        />
        <p className="text-xs text-muted-foreground">
          Тези инструкции ще се използват когато натиснеш &quot;Пренапиши с AI&quot; върху описание на продукт.
        </p>
      </div>
      <Button onClick={handleSave} disabled={loading}>
        {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Записване...</> : 'Запази инструкциите'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit
```
Expected: no TypeScript errors.

- [ ] **Step 4: Test in browser**

Open `http://localhost:3000/settings` → click "AI" tab → enter instructions → save → reload to verify persistence.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/settings/page.tsx src/app/\(admin\)/settings/ai-settings.tsx
git commit -m "feat: add AI instructions settings tab"
```

---

## Verification Checklist

- [ ] `curl POST /api/fetch-product` returns `{ title, description, images[], price }`
- [ ] `curl POST /api/fetch-images` downloads and stores images in Supabase
- [ ] `curl POST /api/ai/rewrite` returns Bulgarian description from DeepSeek
- [ ] `curl GET/POST /api/settings/ai-instructions` stores and retrieves instructions
- [ ] ProductForm at `/catalog/new` shows compact 3-column layout
- [ ] "Издърпай" button populates name, price, description, images
- [ ] "Пренапиши с AI" rewrites description in Bulgarian
- [ ] Settings → AI tab saves and loads instructions
- [ ] Auth still works (login, signout, role-based redirect)
- [ ] `npx tsc --noEmit` passes with no errors
