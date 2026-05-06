# Unified POS Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-product record-sale page with a unified POS combining product grid (categories, search, frequently sold) and multi-product cart for grouped sales.

**Architecture:** Server component fetches initial data (products, categories, frequently sold, stores). Client component holds all interactive state — search, category filter, cart (useReducer), store selection. Single 60/40 split layout with product grid left and cart sidebar right.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, Supabase SSR, Radix UI (Select, Toast), Tailwind, lucide-react

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/00003_add_sale_group_id.sql`

- [ ] **Step 1: Create migration file**

```sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_sales_sale_group ON sales(sale_group_id);
```

- [ ] **Step 2: Apply migration**

Run: `supabase migration up` (if local Supabase) or apply via MCP `apply_migration` for remote project.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add supabase/migrations/00003_add_sale_group_id.sql
git commit -m "feat: add sale_group_id column for grouped POS sales"
```

---

### Task 2: Cart Types and Reducer

**Files:**
- Create: `src/components/pos/cart-types.ts`
- Create: `src/components/pos/cart-reducer.ts`

- [ ] **Step 1: Write cart types**

```typescript
// src/components/pos/cart-types.ts

export type Product = {
  id: string
  name: string
  price: number | null
  quantity_on_hand: number
  image_url?: string | null
  category_id: string | null
}

export type CartItem = {
  product: Product
  qty: number
}

export type CartState = {
  items: CartItem[]
}

export type CartAction =
  | { type: 'ADD'; product: Product }
  | { type: 'REMOVE'; productId: string }
  | { type: 'SET_QTY'; productId: string; qty: number }
  | { type: 'CLEAR' }
```

- [ ] **Step 2: Write cart reducer**

```typescript
// src/components/pos/cart-reducer.ts

import { CartState, CartAction } from './cart-types'

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD': {
      const existing = state.items.find(i => i.product.id === action.product.id)
      if (existing) {
        return {
          items: state.items.map(i =>
            i.product.id === action.product.id ? { ...i, qty: i.qty + 1 } : i
          ),
        }
      }
      return { items: [...state.items, { product: action.product, qty: 1 }] }
    }

    case 'REMOVE':
      return { items: state.items.filter(i => i.product.id !== action.productId) }

    case 'SET_QTY': {
      if (action.qty <= 0) {
        return { items: state.items.filter(i => i.product.id !== action.productId) }
      }
      return {
        items: state.items.map(i =>
          i.product.id === action.productId ? { ...i, qty: action.qty } : i
        ),
      }
    }

    case 'CLEAR':
      return { items: [] }

    default:
      return state
  }
}

export const initialCartState: CartState = { items: [] }
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/pos/cart-types.ts src/components/pos/cart-reducer.ts
git commit -m "feat: add cart types and reducer for multi-product POS"
```

---

### Task 3: Group Sale API Route

**Files:**
- Create: `src/app/api/sales/group/route.ts`

- [ ] **Step 1: Write API route**

```typescript
// src/app/api/sales/group/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await (supabase.from('users') as any)
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 403 })
  }

  const body = await request.json()
  const { store_id, items } = body as {
    store_id: string
    items: { product_id: string; quantity: number; unit_price: number }[]
  }

  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Поне един продукт е задължителен' }, { status: 400 })
  }

  if (!store_id) {
    return NextResponse.json({ error: 'Липсва магазин' }, { status: 400 })
  }

  // Verify store access
  const { data: store } = await (supabase.from('stores') as any)
    .select('id')
    .eq('id', store_id)
    .single()

  if (!store) {
    return NextResponse.json({ error: 'Нямате достъп до този магазин' }, { status: 403 })
  }

  const saleGroupId = crypto.randomUUID()

  const rows = items.map(item => ({
    product_id: item.product_id,
    store_id,
    sold_by: user.id,
    quantity: item.quantity,
    sale_price: item.unit_price,
    sale_date: new Date().toISOString().split('T')[0],
    sale_group_id: saleGroupId,
  }))

  const { error: insertError } = await (supabase.from('sales') as any).insert(rows)

  if (insertError) {
    console.error('Group sale insert error:', insertError)
    return NextResponse.json({ error: 'Грешка при записване' }, { status: 500 })
  }

  // Decrement stock for each product
  for (const item of items) {
    await (supabase.from('products') as any)
      .select('quantity_on_hand')
      .eq('id', item.product_id)
      .single()
      .then(({ data: prod }: any) => {
        if (prod) {
          return (supabase.from('products') as any)
            .update({ quantity_on_hand: Math.max(0, prod.quantity_on_hand - item.quantity) })
            .eq('id', item.product_id)
        }
      })
  }

  return NextResponse.json({ success: true, sale_group_id: saleGroupId, count: items.length })
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/api/sales/group/route.ts
git commit -m "feat: add group sale API endpoint for multi-product POS"
```

---

### Task 4: CartSidebar Component

**Files:**
- Create: `src/components/pos/cart-sidebar.tsx`

- [ ] **Step 1: Write CartSidebar component**

```typescript
// src/components/pos/cart-sidebar.tsx

'use client'

import { Button } from '@/components/ui/button'
import { CartItem } from './cart-types'
import { Minus, Plus, X, ShoppingCart } from 'lucide-react'

interface CartSidebarProps {
  items: CartItem[]
  onAdd: (productId: string) => void
  onRemove: (productId: string) => void
  onSetQty: (productId: string, qty: number) => void
  onSubmit: () => void
  submitting: boolean
}

export function CartSidebar({ items, onAdd, onRemove, onSetQty, onSubmit, submitting }: CartSidebarProps) {
  const total = items.reduce((sum, i) => sum + i.qty * (i.product.price ?? 0), 0)

  return (
    <div className="flex flex-col h-full rounded-lg border bg-white">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Количка
          {items.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ({items.length})
            </span>
          )}
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground text-sm">
          <p>Добавете продукти от мрежата</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="p-3 space-y-2">
            {items.map(item => (
              <div
                key={item.product.id}
                className="flex items-center gap-3 p-3 rounded-md border bg-slate-50/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.product.price != null ? `${item.product.price.toFixed(2)} €` : '—'}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => item.qty <= 1 ? onRemove(item.product.id) : onSetQty(item.product.id, item.qty - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-8 text-center text-sm font-medium tabular-nums">
                    {item.qty}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onAdd(item.product.id)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                <div className="text-right min-w-[60px]">
                  <p className="text-sm font-semibold tabular-nums">
                    {((item.product.price ?? 0) * item.qty).toFixed(2)} €
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-500 shrink-0"
                  onClick={() => onRemove(item.product.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-t space-y-3">
        <div className="flex items-center justify-between text-lg font-bold">
          <span>Общо</span>
          <span className="tabular-nums">{total.toFixed(2)} €</span>
        </div>
        <Button
          className="w-full"
          size="lg"
          disabled={items.length === 0 || submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Записване...' : 'Завърши продажба'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/pos/cart-sidebar.tsx
git commit -m "feat: add CartSidebar component for multi-product POS"
```

---

### Task 5: ProductGrid Component

**Files:**
- Create: `src/components/pos/product-grid.tsx`

- [ ] **Step 1: Write ProductGrid component**

```typescript
// src/components/pos/product-grid.tsx

'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Package, Star } from 'lucide-react'
import { Product } from './cart-types'

interface ProductGridProps {
  products: Product[]
  categories: { id: string; name: string }[]
  frequentlySold: Product[]
  onAddToCart: (product: Product) => void
}

export function ProductGrid({ products, categories, frequentlySold, onAddToCart }: ProductGridProps) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const filtered = products.filter(p => {
    if (selectedCategory && p.category_id !== selectedCategory) return false
    if (search.length >= 2) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Category pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button
          variant={selectedCategory === null ? 'default' : 'outline'}
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => setSelectedCategory(null)}
        >
          Всички
        </Button>
        {categories.map(cat => (
          <Button
            key={cat.id}
            variant={selectedCategory === cat.id ? 'default' : 'outline'}
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.name}
          </Button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Търсене по име или баркод..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          autoComplete="off"
        />
      </div>

      {/* Frequently sold */}
      {frequentlySold.length > 0 && !search && !selectedCategory && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Star className="h-3 w-3" /> Често продавани
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {frequentlySold.map(product => (
              <button
                key={product.id}
                className="flex items-center gap-2 shrink-0 rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors"
                onClick={() => onAddToCart(product)}
              >
                {product.image_url ? (
                  <img src={product.image_url} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">{product.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {product.price != null ? `${product.price.toFixed(2)} €` : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Product grid */}
      <div className="overflow-auto h-[calc(100vh-20rem)]">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            {search.length >= 2
              ? `Няма съвпадения за "${search}"`
              : 'Няма налични продукти'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map(product => (
              <button
                key={product.id}
                className="rounded-lg border bg-white p-3 text-left hover:shadow-md hover:border-slate-300 transition-all"
                onClick={() => onAddToCart(product)}
              >
                <div className="aspect-square bg-slate-100 rounded-md mb-2 flex items-center justify-center overflow-hidden">
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <p className="text-sm font-medium truncate">{product.name}</p>
                <p className="text-sm font-semibold tabular-nums">
                  {product.price != null ? `${product.price.toFixed(2)} €` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {product.quantity_on_hand} бр.
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/pos/product-grid.tsx
git commit -m "feat: add ProductGrid component for POS product browsing"
```

---

### Task 6: POSClient — Main State Container

**Files:**
- Create: `src/components/pos/pos-client.tsx`

- [ ] **Step 1: Write POSClient component**

```typescript
// src/components/pos/pos-client.tsx

'use client'

import { useReducer, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { Product, CartState } from './cart-types'
import { cartReducer, initialCartState } from './cart-reducer'
import { ProductGrid } from './product-grid'
import { CartSidebar } from './cart-sidebar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface POSClientProps {
  products: Product[]
  categories: { id: string; name: string }[]
  frequentlySold: Product[]
  stores: { id: string; name: string }[]
  defaultStoreId: string
}

export function POSClient({ products, categories, frequentlySold, stores, defaultStoreId }: POSClientProps) {
  const { toast } = useToast()
  const [cart, dispatch] = useReducer(cartReducer, initialCartState)
  const [selectedStoreId, setSelectedStoreId] = useState(defaultStoreId)
  const [submitting, setSubmitting] = useState(false)

  const handleAddToCart = (product: Product) => {
    dispatch({ type: 'ADD', product })
  }

  const handleAdd = (productId: string) => {
    const item = cart.items.find(i => i.product.id === productId)
    if (item) {
      dispatch({ type: 'ADD', product: item.product })
    }
  }

  const handleRemove = (productId: string) => {
    dispatch({ type: 'REMOVE', productId })
  }

  const handleSetQty = (productId: string, qty: number) => {
    dispatch({ type: 'SET_QTY', productId, qty })
  }

  const handleSubmit = async () => {
    if (cart.items.length === 0) return

    setSubmitting(true)
    try {
      const db = createClient() as any

      const items = cart.items.map(i => ({
        product_id: i.product.id,
        quantity: i.qty,
        unit_price: i.product.price ?? 0,
      }))

      const res = await fetch('/api/sales/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: selectedStoreId, items }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Грешка при записване')
      }

      // Decrement stock locally
      for (const item of cart.items) {
        const { error: updateError } = await db
          .from('products')
          .update({ quantity_on_hand: item.product.quantity_on_hand - item.qty })
          .eq('id', item.product.id)

        if (updateError) console.error('Stock update error:', updateError)
      }

      toast({ title: 'Продажбата е записана' })
      dispatch({ type: 'CLEAR' })
    } catch (err: any) {
      toast({ title: err.message || 'Грешка при записване', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* Left: Product grid */}
      <div className="flex-1 min-w-0">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Запиши продажба</h1>
            <p className="text-muted-foreground text-sm mt-1">Кликнете върху продукт за добавяне в количката</p>
          </div>
          {stores.length > 1 && (
            <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map(store => (
                  <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <ProductGrid
          products={products}
          categories={categories}
          frequentlySold={frequentlySold}
          onAddToCart={handleAddToCart}
        />
      </div>

      {/* Right: Cart */}
      <div className="w-[380px] shrink-0">
        <CartSidebar
          items={cart.items}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onSetQty={handleSetQty}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/components/pos/pos-client.tsx
git commit -m "feat: add POSClient state container for unified POS"
```

---

### Task 7: Rewrite RecordSale Page (Server Component)

**Files:**
- Modify: `src/app/(seller)/record-sale/page.tsx` (complete rewrite)

- [ ] **Step 1: Write the new page**

```typescript
// src/app/(seller)/record-sale/page.tsx

import { requireAuth, getEffectiveRole } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { POSClient } from '@/components/pos/pos-client'
import { Product } from '@/components/pos/cart-types'
import { AlertTriangle } from 'lucide-react'

type Store = { id: string; name: string }

export default async function RecordSalePage() {
  const user = await requireAuth()
  const effectiveRole = await getEffectiveRole(user)
  const supabase = await createServerSupabaseClient()

  // Fetch stores
  const { data: stores } = await (supabase.from('stores') as any)
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  if (!stores || stores.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>Няма налични обекти. Свържете се с администратор.</p>
      </div>
    )
  }

  // Fetch products
  const { data: products } = await (supabase.from('products') as any)
    .select('id, name, price, quantity_on_hand, category_id')
    .eq('status', 'listed')
    .order('name')

  // Fetch categories
  const { data: categories } = await (supabase.from('categories') as any)
    .select('id, name')
    .order('name')

  // Fetch primary images for all products
  const productIds = (products || []).map((p: any) => p.id)
  const { data: images } = productIds.length > 0
    ? await (supabase.from('product_images') as any)
        .select('product_id, url')
        .in('product_id', productIds)
        .eq('is_primary', true)
    : { data: [] }

  const imageMap: Record<string, string> = {}
  ;(images || []).forEach((img: any) => {
    if (!imageMap[img.product_id]) imageMap[img.product_id] = img.url
  })

  const productsWithImages: Product[] = (products || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    quantity_on_hand: p.quantity_on_hand,
    category_id: p.category_id,
    image_url: imageMap[p.id] || null,
  }))

  // Frequently sold: last 6 from seller + top 6 from store
  let frequentlySold: Product[] = []

  const { data: recentSales } = await (supabase.from('sales') as any)
    .select('product_id')
    .eq('sold_by', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (recentSales && recentSales.length > 0) {
    const seenIds = new Set<string>()
    const uniqueProductIds = recentSales
      .map((s: any) => s.product_id)
      .filter((id: string) => {
        if (seenIds.has(id)) return false
        seenIds.add(id)
        return true
      })
      .slice(0, 6)

    const sellerFreq = productsWithImages.filter(p => uniqueProductIds.includes(p.id))
    const remaining = 12 - sellerFreq.length

    if (remaining > 0) {
      const sellerFreqIds = new Set(sellerFreq.map(p => p.id))
      const storeFreq = productsWithImages
        .filter(p => !sellerFreqIds.has(p.id))
        .slice(0, remaining)

      frequentlySold = [...sellerFreq, ...storeFreq]
    } else {
      frequentlySold = sellerFreq
    }
  }

  // Default store
  let defaultStoreId = user.store_id

  if (!defaultStoreId && user.role === 'admin' && effectiveRole === 'seller') {
    defaultStoreId = stores[0].id
  }

  if (!defaultStoreId) {
    defaultStoreId = stores[0].id
  }

  return (
    <POSClient
      products={productsWithImages}
      categories={(categories || []) as { id: string; name: string }[]}
      frequentlySold={frequentlySold}
      stores={stores as Store[]}
      defaultStoreId={defaultStoreId!}
    />
  )
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(seller\)/record-sale/page.tsx
git commit -m "feat: replace single-product sale page with unified POS"
```

---

### Task 8: Catalog Redirect + Nav Update

**Files:**
- Modify: `src/app/(seller)/seller-catalog/page.tsx`
- Modify: `src/app/(seller)/layout.tsx`

- [ ] **Step 1: Add redirect to seller-catalog**

```typescript
// src/app/(seller)/seller-catalog/page.tsx

import { redirect } from 'next/navigation'

export default function SellerCatalogPage() {
  redirect('/record-sale')
}
```

- [ ] **Step 2: Remove catalog from sidebar nav**

In `src/app/(seller)/layout.tsx`, remove `seller-catalog` from `navItems`:

Change from:
```typescript
const navItems = [
  { href: '/record-sale', label: 'Запиши продажба', icon: ShoppingBag },
  { href: '/my-sales', label: 'Моите продажби', icon: BarChart3 },
  { href: '/seller-catalog', label: 'Каталог', icon: Package2 },
]
```

To:
```typescript
const navItems = [
  { href: '/record-sale', label: 'Запиши продажба', icon: ShoppingBag },
  { href: '/my-sales', label: 'Моите продажби', icon: BarChart3 },
]
```

Also remove the unused `Package2` import.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(seller\)/seller-catalog/page.tsx src/app/\(seller\)/layout.tsx
git commit -m "feat: redirect seller-catalog to unified POS, remove from nav"
```

---

### Task 9: Cleanup — Remove Old SaleEntry

**Files:**
- Delete: `src/components/sales/sale-entry.tsx`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -r "SaleEntry\|sale-entry" /Volumes/External/Users/filewizard/Documents/Apps/Prody/src/ --include='*.ts' --include='*.tsx'`

Expected: No output (no remaining references).

- [ ] **Step 2: Delete the file**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git rm src/components/sales/sale-entry.tsx
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove deprecated SaleEntry component"
```

---

### Task 10: Final Verification

- [ ] **Step 1: TypeScript compilation**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1`

Expected: zero errors.

- [ ] **Step 2: Build check**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npm run build 2>&1 | tail -20`

Expected: successful build.

- [ ] **Step 3: Final commit (if fixes needed)**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add -A
git commit -m "chore: fix compilation issues after POS migration"
```
