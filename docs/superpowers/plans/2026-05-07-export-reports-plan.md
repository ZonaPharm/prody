# Excel Export Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 Excel (.xlsx) export types to the reports page — by store, by product, and full detail — using a single API endpoint, without touching existing charts/KPIs.

**Architecture:** New `export-reports.ts` lib generates formatted Excel files via the `xlsx` package. A single `POST /api/reports/export` endpoint receives `{type, from, to, store_id?}` and returns the `.xlsx` binary. The reports page gets a new "Експорт" card below existing content with date picker, optional store filter, and 3 export buttons.

**Tech Stack:** Next.js 16, React, Tailwind CSS, shadcn/ui, `xlsx` (SheetJS), existing Supabase queries

---

## File Map

| File | Purpose |
|------|---------|
| `src/lib/export-reports.ts` | Create: Excel generation helpers (column widths, formatting, sheet creation for 3 report types) |
| `src/app/api/reports/export/route.ts` | Create: POST endpoint, accepts type/from/to/store_id, returns .xlsx |
| `src/app/(admin)/reports/page.tsx` | Modify: Add export section card below existing content |
| `package.json` | Modify: Add `xlsx` dependency |

---

### Task 1: Install xlsx dependency and create export lib

**Files:**
- Create: `src/lib/export-reports.ts`
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install xlsx package**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npm install xlsx`

Expected: `xlsx` added to package.json dependencies.

- [ ] **Step 2: Create the export lib**

Create `src/lib/export-reports.ts`:

```typescript
import * as XLSX from 'xlsx'

function autoFilterAndFormat(ws: XLSX.WorkSheet, cols: number) {
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 999, c: cols - 1 } }) }
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map(w => ({ wch: w }))
}

function formatSheet(wb: XLSX.WorkBook, sheetName: string, headers: string[], rows: any[][], colWidths: number[]) {
  const data = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(data)
  setColWidths(ws, colWidths)
  autoFilterAndFormat(ws, headers.length)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return ws
}

function toBuffer(wb: XLSX.WorkBook): Buffer {
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

export interface ExportRequest {
  type: 'store' | 'product' | 'detail'
  from: string
  to: string
  store_id?: string | null
}

export async function buildExportWorkbook(
  req: ExportRequest,
  fetchSales: (query: { from: string; to: string; store_id?: string | null }) => Promise<any[]>
): Promise<Buffer> {
  const sales = await fetchSales(req)
  const wb = XLSX.utils.book_new()

  if (req.type === 'store') {
    // Aggregate by store
    const map: Record<string, { store: string; count: number; revenue: number; cash: number; card: number }> = {}
    sales.forEach((s: any) => {
      const store = s.store_name || '—'
      if (!map[store]) map[store] = { store, count: 0, revenue: 0, cash: 0, card: 0 }
      map[store].count++
      const rev = s.quantity * Number(s.sale_price)
      map[store].revenue += rev
      if (s.payment_method === 'card') map[store].card += rev
      else map[store].cash += rev
    })
    const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue).map(r => [
      r.store, r.count, Math.round(r.revenue * 100) / 100,
      Math.round(r.cash * 100) / 100, Math.round(r.card * 100) / 100,
    ])
    formatSheet(wb, 'По обекти', ['Обект', 'Брой продажби', 'Оборот (€)', 'Кеш (€)', 'Карта (€)'], rows, [20, 14, 14, 14, 14])
  } else if (req.type === 'product') {
    // Aggregate by product
    const map: Record<string, { name: string; category: string; qty: number; revenue: number; stores: Set<string> }> = {}
    sales.forEach((s: any) => {
      const name = s.product_name || '—'
      const cat = s.category_name || '—'
      if (!map[name]) map[name] = { name, category: cat, qty: 0, revenue: 0, stores: new Set() }
      map[name].qty += s.quantity
      map[name].revenue += s.quantity * Number(s.sale_price)
      map[name].stores.add(s.store_name || '—')
    })
    const rows = Object.values(map).sort((a, b) => b.qty - a.qty).map(r => [
      r.name, r.category, r.qty, Math.round(r.revenue * 100) / 100, r.stores.size,
    ])
    formatSheet(wb, 'По продукти', ['Продукт', 'Категория', 'Продадени бр.', 'Оборот (€)', 'Обекти'], rows, [30, 18, 14, 14, 10])
  } else {
    // Full detail
    const rows = sales.map((s: any) => [
      new Date(s.sale_date).toLocaleDateString('bg-BG'),
      s.store_name || '—',
      s.product_name || '—',
      s.category_name || '—',
      s.quantity,
      Number(s.sale_price).toFixed(2),
      (s.quantity * Number(s.sale_price)).toFixed(2),
      s.payment_method === 'card' ? 'Карта' : 'Кеш',
      s.seller_name || '—',
    ])
    formatSheet(wb, 'Пълен детайл', ['Дата', 'Обект', 'Продукт', 'Категория', 'К-во', 'Цена (€)', 'Сума (€)', 'Плащане', 'Продавач'], rows, [12, 18, 30, 18, 8, 10, 10, 10, 18])
  }

  return toBuffer(wb)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -10`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/lib/export-reports.ts package.json package-lock.json
git commit -m "feat: add xlsx export lib with 3 report types"
```

---

### Task 2: Create export API endpoint

**Files:**
- Create: `src/app/api/reports/export/route.ts`

- [ ] **Step 1: Create the API route**

Create directory and file `src/app/api/reports/export/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildExportWorkbook } from '@/lib/export-reports'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any)
    .select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { type, from, to, store_id } = body

  if (!type || !from || !to) {
    return NextResponse.json({ error: 'Липсват задължителни полета' }, { status: 400 })
  }

  const admin = createAdminClient()

  const fetchSales = async (q: { from: string; to: string; store_id?: string | null }) => {
    let query = (admin.from('sales') as any)
      .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users(display_name)')
      .gte('sale_date', q.from)
      .lte('sale_date', q.to)
      .order('sale_date', { ascending: false })
    if (q.store_id) query = query.eq('store_id', q.store_id)
    const { data } = await query

    // Fetch categories separately (category is nested under products, not directly on sales)
    const productIds = [...new Set((data || []).map((s: any) => s.product_id))]
    const { data: prods } = productIds.length > 0
      ? await (admin.from('products') as any).select('id, category:categories(name)').in('id', productIds)
      : { data: [] }
    const catMap: Record<string, string> = {}
    ;(prods || []).forEach((p: any) => {
      const catName = Array.isArray(p.category) ? p.category[0]?.name : p.category?.name
      if (catName) catMap[p.id] = catName
    })

    return (data || []).map((s: any) => ({
      quantity: s.quantity,
      sale_price: s.sale_price,
      sale_date: s.sale_date,
      payment_method: s.payment_method,
      product_name: Array.isArray(s.product) ? s.product[0]?.name : s.product?.name,
      store_name: Array.isArray(s.store) ? s.store[0]?.name : s.store?.name,
      category_name: catMap[s.product_id] || '—',
      seller_name: Array.isArray(s.seller) ? s.seller[0]?.display_name : s.seller?.display_name,
    }))
  }

  try {
    const buffer = await buildExportWorkbook({ type, from, to, store_id: store_id || null }, fetchSales)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${type}-report-${from}-${to}.xlsx"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -10`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/api/reports/export/route.ts
git commit -m "feat: POST /api/reports/export endpoint for 3 xlsx report types"
```

---

### Task 3: Add export section to reports page

**Files:**
- Modify: `src/app/(admin)/reports/page.tsx` — Add export card at the bottom

- [ ] **Step 1: Add state and fetch logic**

The reports page is a client component. Add state variables and export handler after the existing `load` function (approximately after line 50, after the existing data fetching logic):

```typescript
  // Export state
  const [exportStoreId, setExportStoreId] = useState('')
  const [exportLoading, setExportLoading] = useState('')
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/stores').then(r => r.json()).then(d => setStores(d || [])).catch(() => {})
  }, [])

  const handleExport = async (type: string) => {
    setExportLoading(type)
    try {
      const res = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          from,
          to,
          store_id: exportStoreId || null,
        }),
      })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const labels: Record<string, string> = { store: 'po-obekti', product: 'po-produkti', detail: 'palen-detail' }
      a.download = `${labels[type] || type}-${from}-${to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Грешка при експорт')
    } finally {
      setExportLoading('')
    }
  }
```

- [ ] **Step 2: Add the Export card UI**

Add this Card at the bottom of the return JSX, right before the final closing `</div>`:

```tsx
      {/* Export section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Download className="h-5 w-5" />
            Експорт
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Изтеглете данните в Excel формат с автофилтри и форматиране
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium">От дата</label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">До дата</label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Магазин</label>
              <Select value={exportStoreId} onValueChange={setExportStoreId}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Всички магазини" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Всички магазини</SelectItem>
                  {stores.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-1"
              onClick={() => handleExport('store')} disabled={exportLoading === 'store'}>
              {exportLoading === 'store' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Building2 className="h-5 w-5" />}
              <span className="font-medium">По обекти</span>
              <span className="text-[10px] text-muted-foreground">Оборот и брой по магазин</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-1"
              onClick={() => handleExport('product')} disabled={exportLoading === 'product'}>
              {exportLoading === 'product' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Package className="h-5 w-5" />}
              <span className="font-medium">По продукти</span>
              <span className="text-[10px] text-muted-foreground">Количество и сума по продукт</span>
            </Button>
            <Button variant="outline" className="h-auto py-4 flex flex-col items-center gap-1"
              onClick={() => handleExport('detail')} disabled={exportLoading === 'detail'}>
              {exportLoading === 'detail' ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileSpreadsheet className="h-5 w-5" />}
              <span className="font-medium">Пълен детайл</span>
              <span className="text-[10px] text-muted-foreground">Всяка продажба като ред</span>
            </Button>
          </div>
        </CardContent>
      </Card>
```

- [ ] **Step 3: Add missing imports to reports page**

Add to the lucide-react import line: `Download, Building2, FileSpreadsheet, Loader2`.
Add to the shadcn imports: `Select, SelectContent, SelectItem, SelectTrigger, SelectValue`.

- [ ] **Step 4: Fix the exportStoreId logic**

In `handleExport`, change `exportStoreId || null` to `(exportStoreId && exportStoreId !== '__all__') ? exportStoreId : null`.

- [ ] **Step 5: Verify TypeScript**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(admin\)/reports/page.tsx
git commit -m "feat: add Excel export section with 3 report types to reports page"
```

---

### Task 4: Final Verification & Push

- [ ] **Step 1: TypeScript check**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | grep -c "error" || echo "0"`

Expected: 0 errors.

- [ ] **Step 2: Push to both remotes**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git push origin main
git push github main
```

- [ ] **Step 3: Verify Vercel deployment**

Check the Vercel dashboard — deployment should reach READY state.
