# Email Weekly Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMTP-based email sending with weekly report containing HTML body + Excel attachment, configurable via Settings UI.

**Architecture:** Nodemailer sends emails via configured SMTP server. Settings stored in `email_settings` singleton table, managed via API. Vercel Cron checks weekly and sends if day/hour matches. Settings UI is a new tab in the existing settings page.

**Tech Stack:** Next.js 16, nodemailer, shadcn/ui, Tailwind CSS, Supabase, Vercel Cron Jobs, existing export-reports lib

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/email.ts` | Create | Nodemailer transport, HTML builder, sendWeeklyReport |
| `src/app/api/email-settings/route.ts` | Create | GET/POST settings CRUD |
| `src/app/api/cron/weekly-report/route.ts` | Create | Cron handler, checks day/time, sends |
| `src/app/api/reports/send-email/route.ts` | Create | Manual test send |
| `src/app/(admin)/settings/email-settings.tsx` | Create | Settings UI component |
| `src/app/(admin)/settings/page.tsx` | Modify | Add "Имейл" tab |
| `supabase/migrations/00011_email_settings.sql` | Create | DB table |

---

### Task 1: Install nodemailer, migration, and email lib

**Files:**
- Create: `supabase/migrations/00011_email_settings.sql`
- Create: `src/lib/email.ts`
- Modify: `package.json` (npm install)

- [ ] **Step 1: Install nodemailer**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npm install nodemailer`

- [ ] **Step 2: Create migration**

Create `supabase/migrations/00011_email_settings.sql`:

```sql
CREATE TABLE IF NOT EXISTS email_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  smtp_host text DEFAULT 'smtp.gmail.com',
  smtp_port int DEFAULT 587,
  smtp_user text,
  smtp_pass text,
  sender_email text,
  recipients jsonb DEFAULT '[]',
  report_day int DEFAULT 5,
  report_hour int DEFAULT 18,
  report_minute int DEFAULT 0,
  report_sections jsonb DEFAULT '["summary","stores","top-products","top-revenue","low-stock"]',
  updated_at timestamptz DEFAULT now()
);

INSERT INTO email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins full access email_settings" ON email_settings;
CREATE POLICY "Admins full access email_settings" ON email_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 3: Create email lib**

Create `src/lib/email.ts`:

```typescript
import nodemailer from 'nodemailer'
import { buildExportWorkbook, type ExportRequest } from '@/lib/export-reports'

interface EmailSettings {
  smtp_host: string
  smtp_port: number
  smtp_user: string
  smtp_pass: string
  sender_email: string
  recipients: string[]
  report_day: number
  report_hour: number
  report_minute: number
  report_sections: string[]
}

function createTransport(settings: EmailSettings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: settings.smtp_port,
    secure: settings.smtp_port === 465,
    auth: { user: settings.smtp_user, pass: settings.smtp_pass },
  })
}

function buildHtml(data: any, sections: string[]): string {
  const parts: string[] = []
  parts.push(`<h2>Седмичен отчет — Prody</h2>`)
  parts.push(`<p>Период: ${new Date(Date.now() - 7 * 86400000).toLocaleDateString('bg-BG')} — ${new Date().toLocaleDateString('bg-BG')}</p>`)

  if (sections.includes('summary')) {
    parts.push(`<h3>Общо</h3>`)
    parts.push(`<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse">`)
    parts.push(`<tr><td><strong>Оборот</strong></td><td>${data.totalRevenue?.toFixed(0) || 0} €</td></tr>`)
    parts.push(`<tr><td><strong>Брой продажби</strong></td><td>${data.totalCount || 0}</td></tr>`)
    parts.push(`<tr><td><strong>Уникални продукти</strong></td><td>${data.uniqueProducts || 0}</td></tr>`)
    parts.push(`<tr><td><strong>Среден чек</strong></td><td>${data.totalCount > 0 ? (data.totalRevenue / data.totalCount).toFixed(0) : '0'} €</td></tr>`)
    parts.push(`</table>`)
  }

  if (sections.includes('stores') && data.storeBreakdown) {
    parts.push(`<h3>По обекти</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><th>Обект</th><th>Брой</th><th>Оборот</th></tr>`)
    data.storeBreakdown.forEach((s: any) => parts.push(`<tr><td>${s.store}</td><td>${s.count}</td><td>${s.revenue.toFixed(0)} €</td></tr>`))
    parts.push(`</table>`)
  }

  if (sections.includes('top-products') && data.topProducts) {
    parts.push(`<h3>Топ продукти (брой)</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><th>Продукт</th><th>Брой</th></tr>`)
    data.topProducts.slice(0, 5).forEach((p: any) => parts.push(`<tr><td>${p.name}</td><td>${p.quantity}</td></tr>`))
    parts.push(`</table>`)
  }

  if (sections.includes('low-stock') && data.lowStock) {
    parts.push(`<h3>Ниски наличности</h3><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse"><tr><th>Продукт</th><th>Наличност</th></tr>`)
    data.lowStock.forEach((p: any) => parts.push(`<tr><td>${p.name}</td><td style="color:${p.quantity_on_hand === 0 ? 'red' : 'orange'}">${p.quantity_on_hand} бр.</td></tr>`))
    parts.push(`</table>`)
  }

  return parts.join('\n')
}

export async function sendWeeklyReport(
  settings: EmailSettings,
  reportData: any,
  fetchSalesForExport: (query: { from: string; to: string; store_id?: string | null }) => Promise<any[]>
) {
  const transport = createTransport(settings)
  const html = buildHtml(reportData, settings.report_sections || ['summary'])

  // Build Excel attachment
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]
  const excelBuffer = await buildExportWorkbook(
    { type: 'detail', from: weekAgo, to: today },
    fetchSalesForExport
  )

  await transport.sendMail({
    from: settings.sender_email,
    to: settings.recipients.join(', '),
    subject: `Седмичен отчет Prody — ${weekAgo} / ${today}`,
    html,
    attachments: [{
      filename: `sedmichen-otchet-${weekAgo}-${today}.xlsx`,
      content: excelBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  })
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -10`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/lib/email.ts supabase/migrations/00011_email_settings.sql package.json package-lock.json
git commit -m "feat: add nodemailer, email_settings migration, and email lib"
```

---

### Task 2: Create API routes (settings CRUD + cron + test send)

**Files:**
- Create: `src/app/api/email-settings/route.ts`
- Create: `src/app/api/cron/weekly-report/route.ts`
- Create: `src/app/api/reports/send-email/route.ts`

- [ ] **Step 1: Create email-settings API**

Create `src/app/api/email-settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await (supabase.from('email_settings') as any).select('*').eq('id', 1).single()
  return NextResponse.json(data || {})
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { data, error } = await (supabase.from('email_settings') as any)
    .upsert({ id: 1, ...body, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

- [ ] **Step 2: Create cron route**

Create `src/app/api/cron/weekly-report/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWeeklyReport } from '@/lib/email'

export async function GET(request: Request) {
  // Verify Vercel Cron auth header
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()

  if (!settings || !settings.smtp_host || !settings.smtp_user) {
    return NextResponse.json({ error: 'SMTP not configured' }, { status: 400 })
  }

  // Check if current day/hour matches
  const now = new Date()
  if (now.getDay() !== settings.report_day) {
    return NextResponse.json({ skipped: true, reason: 'wrong_day' })
  }
  if (now.getHours() !== settings.report_hour || now.getMinutes() < settings.report_minute || now.getMinutes() >= settings.report_minute + 5) {
    return NextResponse.json({ skipped: true, reason: 'wrong_time' })
  }

  // Fetch report data
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const { data: sales } = await (admin.from('sales') as any)
    .select('quantity, sale_price, sale_date, product:products(name)')
    .gte('sale_date', weekAgo).lte('sale_date', today)

  const productQty = new Map<string, number>()
  let totalRevenue = 0, totalCount = 0
  const productSet = new Set<string>()

  ;(sales || []).forEach((s: any) => {
    const name = Array.isArray(s.product) ? s.product[0]?.name : s.product?.name || '—'
    const rev = s.quantity * Number(s.sale_price)
    productQty.set(name, (productQty.get(name) || 0) + s.quantity)
    totalRevenue += rev
    totalCount++
    productSet.add(name)
  })

  const topProducts = Array.from(productQty.entries()).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

  const { data: lowStock } = await (admin.from('products') as any).select('name, quantity_on_hand').eq('status', 'active').lte('quantity_on_hand', 5).order('quantity_on_hand')

  // Store breakdown
  const { data: storeSales } = await (admin.from('sales') as any).select('quantity, sale_price, store:stores(name)').gte('sale_date', weekAgo).lte('sale_date', today)
  const storeMap: Record<string, { count: number; revenue: number }> = {}
  ;(storeSales || []).forEach((s: any) => {
    const store = Array.isArray(s.store) ? s.store[0]?.name : s.store?.name || '—'
    if (!storeMap[store]) storeMap[store] = { count: 0, revenue: 0 }
    storeMap[store].count++
    storeMap[store].revenue += s.quantity * Number(s.sale_price)
  })
  const storeBreakdown = Object.entries(storeMap).map(([store, v]) => ({ store, count: v.count, revenue: Math.round(v.revenue * 100) / 100 }))

  // Build report data
  const reportData = {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCount,
    uniqueProducts: productSet.size,
    topProducts,
    lowStock: lowStock || [],
    storeBreakdown,
  }

  // Fetch sales for Excel export
  const fetchSalesForExport = async (q: { from: string; to: string; store_id?: string | null }) => {
    let query = (admin.from('sales') as any)
      .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users(display_name)')
      .gte('sale_date', q.from).lte('sale_date', q.to).order('sale_date', { ascending: false })
    if (q.store_id) query = query.eq('store_id', q.store_id)
    const { data } = await query
    const productIds = [...new Set((data || []).map((s: any) => s.product_id))]
    const { data: prods } = productIds.length > 0 ? await (admin.from('products') as any).select('id, category:categories(name)').in('id', productIds) : { data: [] }
    const catMap: Record<string, string> = {}
    ;(prods || []).forEach((p: any) => { const cn = Array.isArray(p.category) ? p.category[0]?.name : p.category?.name; if (cn) catMap[p.id] = cn })
    return (data || []).map((s: any) => ({
      quantity: s.quantity, sale_price: s.sale_price, sale_date: s.sale_date, payment_method: s.payment_method,
      product_name: Array.isArray(s.product) ? s.product[0]?.name : s.product?.name,
      store_name: Array.isArray(s.store) ? s.store[0]?.name : s.store?.name,
      category_name: catMap[s.product_id] || '—',
      seller_name: Array.isArray(s.seller) ? s.seller[0]?.display_name : s.seller?.display_name,
    }))
  }

  const parsed = { ...settings, recipients: (settings.recipients || []) as string[] }
  await sendWeeklyReport(parsed, reportData, fetchSalesForExport)
  return NextResponse.json({ sent: true, recipients: parsed.recipients.length })
}
```

- [ ] **Step 3: Create test send route**

Create `src/app/api/reports/send-email/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendWeeklyReport } from '@/lib/email'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await (supabase.from('users') as any).select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: settings } = await (admin.from('email_settings') as any).select('*').eq('id', 1).single()
  if (!settings || !settings.smtp_host) return NextResponse.json({ error: 'SMTP not configured' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  // Allow override recipients for test
  if (body.test_email) settings.recipients = [body.test_email]

  try {
    // Reuse same data fetch as cron (simplified — same logic)
    const weekAgo = body.from || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const today = body.to || new Date().toISOString().split('T')[0]

    const { data: sales } = await (admin.from('sales') as any)
      .select('quantity, sale_price, product:products(name)')
      .gte('sale_date', weekAgo).lte('sale_date', today)

    const productQty = new Map<string, number>()
    let totalRevenue = 0, totalCount = 0
    const productSet = new Set<string>()
    ;(sales || []).forEach((s: any) => {
      const name = Array.isArray(s.product) ? s.product[0]?.name : s.product?.name || '—'
      productQty.set(name, (productQty.get(name) || 0) + s.quantity)
      totalRevenue += s.quantity * Number(s.sale_price)
      totalCount++; productSet.add(name)
    })

    const reportData = {
      totalRevenue: Math.round(totalRevenue * 100) / 100, totalCount, uniqueProducts: productSet.size,
      topProducts: Array.from(productQty.entries()).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
      lowStock: [],
      storeBreakdown: [],
    }

    const fetchSalesForExport = async (q: { from: string; to: string; store_id?: string | null }) => {
      let query = (admin.from('sales') as any)
        .select('quantity, sale_price, sale_date, payment_method, product_id, product:products(name), store:stores(name), seller:users(display_name)')
        .gte('sale_date', q.from).lte('sale_date', q.to).order('sale_date', { ascending: false })
      const { data } = await query
      return (data || []).map((s: any) => ({
        quantity: s.quantity, sale_price: s.sale_price, sale_date: s.sale_date, payment_method: s.payment_method,
        product_name: Array.isArray(s.product) ? s.product[0]?.name : s.product?.name,
        store_name: Array.isArray(s.store) ? s.store[0]?.name : s.store?.name,
        category_name: '—', seller_name: Array.isArray(s.seller) ? s.seller[0]?.display_name : s.seller?.display_name,
      }))
    }

    const parsed = { ...settings, recipients: (settings.recipients || []) as string[] }
    await sendWeeklyReport(parsed, reportData, fetchSalesForExport)
    return NextResponse.json({ sent: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -15`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/api/email-settings/ src/app/api/cron/ src/app/api/reports/send-email/
git commit -m "feat: email settings API, cron route, and test send endpoint"
```

---

### Task 3: Create email settings UI component

**Files:**
- Create: `src/app/(admin)/settings/email-settings.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/(admin)/settings/email-settings.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Save, Send, Plus, X, Loader2 } from 'lucide-react'

const DAYS = ['Неделя', 'Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота']
const SECTIONS = [
  { key: 'summary', label: 'Общо — оборот, брой продажби, среден чек' },
  { key: 'stores', label: 'По обекти — оборот по магазини' },
  { key: 'top-products', label: 'Топ продукти — най-продавани (брой)' },
  { key: 'top-revenue', label: 'Топ приходи — най-продавани (оборот)' },
  { key: 'low-stock', label: 'Ниски наличности — продукти под минимума' },
]

export function EmailSettings() {
  const [settings, setSettings] = useState<any>(null)
  const [newRecipient, setNewRecipient] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    fetch('/api/email-settings').then(r => r.json()).then(setSettings)
  }, [])

  const save = async () => {
    setSaving(true)
    await fetch('/api/email-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setToast('Запазено')
    setTimeout(() => setToast(''), 2000)
  }

  const testSend = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/reports/send-email', { method: 'POST' })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error) }
      setToast('Тестов мейл изпратен')
    } catch (e: any) { setToast('Грешка: ' + (e.message || 'неуспешно')) }
    setTesting(false)
    setTimeout(() => setToast(''), 3000)
  }

  const addRecipient = () => {
    if (!newRecipient || !newRecipient.includes('@')) return
    const list = settings?.recipients || []
    if (!list.includes(newRecipient)) {
      setSettings({ ...settings, recipients: [...list, newRecipient] })
    }
    setNewRecipient('')
  }

  const removeRecipient = (email: string) => {
    setSettings({ ...settings, recipients: (settings?.recipients || []).filter((e: string) => e !== email) })
  }

  const toggleSection = (key: string) => {
    const list = settings?.report_sections || []
    const next = list.includes(key) ? list.filter((s: string) => s !== key) : [...list, key]
    setSettings({ ...settings, report_sections: next })
  }

  if (!settings) return <div className="p-4 text-muted-foreground">Зареждане...</div>

  return (
    <Card>
      {toast && <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm">{toast}</div>}
      <CardHeader>
        <CardTitle className="text-lg">Имейл настройки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* SMTP */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">SMTP Хост</Label>
            <Input value={settings.smtp_host || ''} onChange={e => setSettings({ ...settings, smtp_host: e.target.value })} placeholder="smtp.gmail.com" className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SMTP Порт</Label>
            <Input type="number" value={settings.smtp_port || 587} onChange={e => setSettings({ ...settings, smtp_port: parseInt(e.target.value) || 587 })} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Потребител</Label>
            <Input value={settings.smtp_user || ''} onChange={e => setSettings({ ...settings, smtp_user: e.target.value })} placeholder="prody@gmail.com" className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Парола (App Password)</Label>
            <Input type="password" value={settings.smtp_pass || ''} onChange={e => setSettings({ ...settings, smtp_pass: e.target.value })} className="h-9" />
          </div>
        </div>

        {/* Sender */}
        <div className="space-y-1 max-w-sm">
          <Label className="text-xs">Имейл подател</Label>
          <Input value={settings.sender_email || ''} onChange={e => setSettings({ ...settings, sender_email: e.target.value })} placeholder="prody@zonapharm.com" className="h-9" />
        </div>

        {/* Recipients */}
        <div className="space-y-2">
          <Label className="text-xs">Получатели</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {(settings.recipients || []).map((email: string) => (
              <span key={email} className="inline-flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1 text-sm">
                📧 {email}
                <button onClick={() => removeRecipient(email)} className="text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newRecipient} onChange={e => setNewRecipient(e.target.value)} placeholder="email@example.com" className="h-9 max-w-xs"
              onKeyDown={e => e.key === 'Enter' && addRecipient()} />
            <Button size="sm" variant="outline" onClick={addRecipient}><Plus className="mr-1 h-3 w-3" />Добави</Button>
          </div>
        </div>

        {/* Report schedule */}
        <div className="flex items-center gap-4">
          <Label className="text-sm">Седмичен отчет:</Label>
          <Select value={String(settings.report_day || 5)} onValueChange={v => setSettings({ ...settings, report_day: parseInt(v) })}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(settings.report_hour || 18)} onValueChange={v => setSettings({ ...settings, report_hour: parseInt(v) })}>
            <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)}>{i}:00</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Sections */}
        <div className="space-y-2">
          <Label className="text-xs">Съдържание на отчета</Label>
          {SECTIONS.map(s => (
            <div key={s.key} className="flex items-center gap-2">
              <Checkbox id={`sec-${s.key}`} checked={(settings.report_sections || []).includes(s.key)} onCheckedChange={() => toggleSection(s.key)} />
              <label htmlFor={`sec-${s.key}`} className="text-sm">{s.label}</label>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2 border-t">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Запази
          </Button>
          <Button variant="outline" onClick={testSend} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Изпрати тестов отчет
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Add Checkbox to shadcn if missing**

Check if `src/components/ui/checkbox.tsx` exists. If not, create it via `npx shadcn@latest add checkbox`.

- [ ] **Step 3: Verify TypeScript**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -15`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(admin\)/settings/email-settings.tsx src/components/ui/checkbox.tsx 2>/dev/null
git commit -m "feat: email settings UI component with SMTP config"
```

---

### Task 4: Add Email tab to settings page

**Files:**
- Modify: `src/app/(admin)/settings/page.tsx` — add import and tab

- [ ] **Step 1: Add import and tab**

Read the file and add:
```typescript
import { EmailSettings } from './email-settings'
```

And add a new tab inside the `<TabsContent>` elements:
```tsx
        <TabsContent value="email">
          <EmailSettings />
        </TabsContent>
```

And add a trigger:
```tsx
          <TabsTrigger value="email">Имейл</TabsTrigger>
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | head -15`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /Volumes/External/Users/filewizard/Documents/Apps/Prody
git add src/app/\(admin\)/settings/page.tsx
git commit -m "feat: add email tab to settings page"
```

---

### Task 5: Final Verification & Push

- [ ] **Step 1: TypeScript check**

Run: `cd /Volumes/External/Users/filewizard/Documents/Apps/Prody && npx tsc --noEmit 2>&1 | grep -c "error" || echo "0"`

Expected: 0 errors.

- [ ] **Step 2: Push to both remotes**

```bash
git push origin main && git push github main
```

- [ ] **Step 3: Apply migration**

The `email_settings` migration must be applied via Supabase SQL Editor.

- [ ] **Step 4: Set Cron Secret**

Add `CRON_SECRET` environment variable in Vercel dashboard (generate a random string). Then configure Vercel Cron Job:
```json
{
  "crons": [{
    "path": "/api/cron/weekly-report",
    "schedule": "*/5 * * * *"
  }]
}
```

The cron runs every 5 minutes but only sends if day/hour/minute match the settings.
