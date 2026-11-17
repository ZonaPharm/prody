'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Copy, Loader2, Mail, Phone, Plus, Printer, Search, Store, Trash2, X } from 'lucide-react'
import { ProductPicker, ProductThumb } from '@/components/deliveries/product-picker'
import { PlanEditor, planNumbers, type PlanText } from '@/components/deliveries/plan-editor'
import { overPlanned, planRows, planSummary } from '@/lib/deliveries/plan'
import type { StoreOption } from '@/lib/deliveries/queries'
import { formatOrderNumber, orderText, orderTotals, splitForSupplier } from '@/lib/supplier-orders/format'
import { overPlannedLine, planText, planTotals } from '@/lib/supplier-orders/plan'
import type { OrderPlan, SupplierContact, SupplierProduct } from '@/lib/supplier-orders/queries'
import { cn } from '@/lib/utils'
import { Empty, Hint, Meta, Note, PageHeader, SectionTitle } from '@/components/ui/text'

/**
 * A new order to a supplier, in three steps shown at the top:
 *   1 Доставчик   pick who we order from
 *   2 Продукти    what and how many (their usual products are listed to tap),
 *                 and under each line how many go to which store (the rest
 *                 stays in Офис); "Пристигна" carries that split into the delivery
 *   3 Изпращане   see the order as the supplier will (without the split), then send it
 * The draft is saved when moving to step 3 and with "Запази черновата".
 */

export type LineProduct = { id: string; name: string; sku: string | null; image: string | null; quantity_on_hand: number; status: string }
type Line = { product: LineProduct; quantity: string; note: string; noteOpen: boolean; hint: number | null; plan: PlanText; planOpen: boolean }

export type OrderDraftInitial = {
  id: string
  number: number
  updated_at: string
  supplier_id: string
  notes: string
  share_plan?: boolean
  lines: { product: LineProduct; quantity: number; note: string | null; plan?: OrderPlan }[]
}

type Step = 1 | 2 | 3

function parseQty(s: string): number | null {
  const t = s.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 1_000_000 ? n : null
}

export function OrderEditor({
  initial,
  suppliers,
  stores,
  presetSupplierId,
  signature,
  mailReady,
  senderName,
}: {
  initial: OrderDraftInitial | null
  suppliers: SupplierContact[]
  /** Active stores, the warehouse among them; the warehouse gets what is not split. */
  stores: StoreOption[]
  presetSupplierId?: string | null
  signature: string | null
  mailReady: boolean
  senderName: string
}) {
  const router = useRouter()
  const startSupplier = initial?.supplier_id ?? (suppliers.some(s => s.id === presetSupplierId) ? presetSupplierId! : null)
  const [step, setStep] = useState<Step>(startSupplier ? 2 : 1)
  const [supplierId, setSupplierId] = useState<string | null>(startSupplier)
  const [lines, setLines] = useState<Line[]>(
    () => initial?.lines.map(l => ({
      product: l.product, quantity: String(l.quantity), note: l.note ?? '', noteOpen: !!l.note, hint: null,
      plan: planText(l.plan), planOpen: false,
    })) ?? [],
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [sharePlan, setSharePlan] = useState(initial?.share_plan ?? false)
  const [id, setId] = useState<string | null>(initial?.id ?? null)
  const [number, setNumber] = useState<number | null>(initial?.number ?? null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial?.updated_at ?? null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'email' | 'manual' | 'delete'>('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const qtyRefs = useRef(new Map<string, HTMLInputElement>())
  const focusNext = useRef<string | null>(null)

  const warehouseName = stores.find(s => s.is_warehouse)?.name ?? 'Офис'
  const shopStores = useMemo(() => stores.filter(s => !s.is_warehouse), [stores])
  const supplier = suppliers.find(s => s.id === supplierId) ?? null
  const inOrder = useMemo(() => new Set(lines.map(l => l.product.id)), [lines])
  const badLines = lines.filter(l => parseQty(l.quantity) == null)
  const totals = orderTotals(lines.map(l => ({ quantity: parseQty(l.quantity) ?? 0 })))
  const split = planTotals(lines.map(l => ({ plan: planNumbers(l.plan) })))

  useEffect(() => {
    if (focusNext.current) {
      qtyRefs.current.get(focusNext.current)?.focus()
      focusNext.current = null
    }
  }, [lines])

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  function touch() { setDirty(true); setError('') }

  function addProduct(p: LineProduct, hint: number | null = null) {
    if (inOrder.has(p.id)) {
      qtyRefs.current.get(p.id)?.focus()
      return
    }
    focusNext.current = p.id
    setLines(ls => [...ls, { product: p, quantity: '', note: '', noteOpen: false, hint, plan: {}, planOpen: false }])
    touch()
  }

  function updateLine(pid: string, patch: Partial<Line>) {
    setLines(ls => ls.map(l => (l.product.id === pid ? { ...l, ...patch } : l)))
    touch()
  }

  function removeLine(pid: string) {
    setLines(ls => ls.filter(l => l.product.id !== pid))
    touch()
  }

  async function save(): Promise<string | null> {
    if (!supplierId) return null
    setBusy('save')
    setError('')
    try {
      const res = await fetch('/api/supplier-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          expected_updated_at: updatedAt,
          supplier_id: supplierId,
          notes: notes.trim() || null,
          share_plan: sharePlan,
          items: lines.map(l => ({
            product_id: l.product.id,
            quantity: parseQty(l.quantity),
            note: l.note.trim() || null,
            plan: planRows(planNumbers(l.plan)),
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Поръчката не се запази')
      setId(data.id)
      setNumber(data.number)
      setUpdatedAt(data.updated_at)
      setDirty(false)
      if (!id) window.history.replaceState(null, '', `/deliveries/orders/${data.id}`)
      return data.id as string
    } catch (e: any) {
      setError(e.message)
      return null
    } finally {
      setBusy('')
    }
  }

  async function toReview() {
    if (lines.length === 0) { setError('Добавете поне един продукт'); return }
    if (badLines.length > 0) {
      setError(`Напишете колко бройки за „${badLines[0].product.name}“`)
      qtyRefs.current.get(badLines[0].product.id)?.focus()
      return
    }
    const over = overPlannedLine(lines.map(l => ({ name: l.product.name, quantity: parseQty(l.quantity), plan: planNumbers(l.plan) })))
    if (over) {
      setError(over)
      const bad = lines.find(l => overPlanned(parseQty(l.quantity) ?? 0, planNumbers(l.plan)) > 0)
      if (bad) setLines(ls => ls.map(l => (l.product.id === bad.product.id ? { ...l, planOpen: true } : l)))
      return
    }
    if (await save()) setStep(3)
  }

  async function send(via: 'email' | 'manual') {
    let orderId = id
    if (dirty || !orderId) orderId = await save()
    if (!orderId) return
    setBusy(via)
    setError('')
    try {
      const res = await fetch(`/api/supplier-orders/${orderId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ via }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Поръчката не тръгна')
      router.push(`/deliveries/orders/${orderId}?sent=${via}`)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setBusy('')
    }
  }

  async function removeDraft() {
    if (!id) { router.push('/deliveries/orders'); return }
    if (!confirm('Да изтрия ли тази чернова? Тя не е изпращана.')) return
    setBusy('delete')
    const res = await fetch(`/api/supplier-orders/${id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Не се изтри'); setBusy(''); return }
    setDirty(false)
    router.push('/deliveries/orders')
    router.refresh()
  }

  const supplierSplit = sharePlan
    ? splitForSupplier(lines.map(l => ({ quantity: parseQty(l.quantity) ?? 0, plan: planNumbers(l.plan) })), stores)
    : null
  const preview = supplier
    ? orderText({
        number: number ?? 0,
        supplierName: supplier.name,
        contactName: supplier.contact_name,
        notes: notes.trim() || null,
        signature,
        senderName,
        split: supplierSplit ? { columns: supplierSplit.columns } : null,
        lines: lines.map((l, i) => ({
          name: l.product.name, barcode: null, quantity: parseQty(l.quantity) ?? 0, note: l.note.trim() || null,
          ...(supplierSplit ? { split: supplierSplit.rows[i] } : {}),
        })),
      })
    : ''

  async function copyText() {
    try {
      await navigator.clipboard.writeText(preview)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Копирането не мина: маркирайте текста и го копирайте ръчно')
    }
  }

  const steps: { n: Step; label: string; detail: string }[] = [
    { n: 1, label: 'Доставчик', detail: supplier?.name ?? 'изберете' },
    { n: 2, label: 'Продукти', detail: lines.length ? `${totals.lines} ${totals.lines === 1 ? 'продукт' : 'продукта'}, ${totals.units} бр.` : 'добавете и разпределете' },
    { n: 3, label: 'Изпращане', detail: 'преглед и изпращане' },
  ]

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        back={<Button asChild variant="ghost" size="icon"><Link href="/deliveries/orders" aria-label="Назад към поръчките"><ArrowLeft className="h-4 w-4" /></Link></Button>}
        title={number ? `Поръчка ${formatOrderNumber(number)}` : 'Нова поръчка към доставчик'}
        intro={`Чернова${dirty ? ': има незаписани промени' : id ? ': записана' : ''}. Три стъпки: доставчик, продукти и разпределение, изпращане.`}
        actions={<>
          {id && step !== 1 && (
            <Button variant="outline" onClick={() => void save()} disabled={!!busy || !dirty}>
              {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Запази черновата
            </Button>
          )}
          <Button variant="ghost" className="text-red-600" onClick={removeDraft} disabled={!!busy}>
            <Trash2 className="mr-2 h-4 w-4" />{id ? 'Изтрий' : 'Откажи'}
          </Button>
        </>}
      />

      <ol className="grid grid-cols-3 gap-1 rounded-xl border bg-white p-2" aria-label="Стъпки">
        {steps.map(s => {
          const state = s.n < step ? 'done' : s.n === step ? 'current' : 'todo'
          const canGo = s.n < step || (s.n === 2 && !!supplierId)
          return (
            <li key={s.n} aria-current={state === 'current' ? 'step' : undefined}>
              <button
                type="button"
                disabled={!canGo || !!busy}
                onClick={() => setStep(s.n)}
                className="w-full rounded-lg p-2 text-left enabled:hover:bg-slate-50 disabled:cursor-default"
              >
                <span className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'done' && 'bg-emerald-600 text-white',
                  state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
                  state === 'todo' && 'bg-slate-100 text-slate-500',
                )}>
                  {state === 'done' ? <Check className="h-3.5 w-3.5" /> : s.n}
                </span>
                <span className={cn('mt-1.5 block text-xs font-semibold sm:text-sm', state === 'todo' ? 'text-slate-500' : 'text-slate-900')}>{s.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">{s.detail}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {error && <Note tone="danger">{error}</Note>}

      {step === 1 && (
        <SupplierStep
          suppliers={suppliers}
          selected={supplierId}
          onPick={sid => {
            if (sid !== supplierId) { setSupplierId(sid); touch() }
            setStep(2)
          }}
        />
      )}

      {step === 2 && supplier && (
        // grid-cols-1 + min-w-0: a long product name or e-mail must not widen the page on a phone.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start" data-testid="order-step-products">
          <section className="min-w-0 space-y-3 rounded-xl border bg-white p-3 lg:order-2" aria-label="Поръчката">
            <SectionTitle count={`${totals.lines} ${totals.lines === 1 ? 'продукт' : 'продукта'}, ${totals.units} бр.`}>Поръчвам от {supplier.name}</SectionTitle>
            <ProductPicker onPick={p => addProduct({ id: p.id, name: p.name, sku: p.sku, image: p.image, quantity_on_hand: p.quantity_on_hand, status: p.status })} />
            {lines.length === 0 ? (
              <Hint>Потърсете продукт горе или натиснете <Plus className="inline h-3.5 w-3.5" /> до продукт от списъка „Обикновено взимаме“. После напишете колко бройки и под реда колко за кой магазин.</Hint>
            ) : (
              <ul className="divide-y rounded-lg border">
                {lines.map(l => {
                  const bad = l.quantity !== '' && parseQty(l.quantity) == null
                  return (
                    <li key={l.product.id} className="space-y-1.5 p-2" data-testid="order-line">
                      <div className="flex items-center gap-2">
                        <ProductThumb src={l.product.image} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 break-words text-sm font-medium" title={l.product.name}>{l.product.name}</div>
                          <Meta as="div">наличност {l.product.quantity_on_hand} бр.{l.hint ? ` · последно ${l.hint} бр.` : ''}</Meta>
                        </div>
                        <Input
                          ref={el => { if (el) qtyRefs.current.set(l.product.id, el); else qtyRefs.current.delete(l.product.id) }}
                          value={l.quantity}
                          inputMode="numeric"
                          placeholder="бр."
                          aria-label={`Бройки ${l.product.name}`}
                          className={cn('h-10 w-20 text-right text-base', (bad || (l.quantity === '' && !!error)) && 'border-red-500')}
                          onChange={e => updateLine(l.product.id, { quantity: e.target.value.replace(/[^\d]/g, '') })}
                        />
                        <Button size="icon" variant="ghost" aria-label={`Махни ${l.product.name}`} onClick={() => removeLine(l.product.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <LinePlan
                        quantity={parseQty(l.quantity) ?? 0}
                        plan={l.plan}
                        open={l.planOpen}
                        stores={shopStores}
                        warehouseName={warehouseName}
                        productName={l.product.name}
                        onToggle={() => setLines(ls => ls.map(x => (x.product.id === l.product.id ? { ...x, planOpen: !x.planOpen } : x)))}
                        onChange={plan => updateLine(l.product.id, { plan })}
                      />
                      {l.noteOpen ? (
                        <Input value={l.note} maxLength={300} placeholder="Бележка към доставчика: цвят, размер…" className="h-8 text-sm"
                          onChange={e => updateLine(l.product.id, { note: e.target.value })} />
                      ) : (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => updateLine(l.product.id, { noteOpen: true })}>
                          + бележка към доставчика (цвят, размер…)
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <div>
              <label htmlFor="o-notes" className="text-sm font-medium">Бележка към цялата поръчка <span className="font-normal text-muted-foreground">(по избор)</span></label>
              <Textarea id="o-notes" value={notes} maxLength={2000} rows={2} placeholder="Например: доставка до петък"
                onChange={e => { setNotes(e.target.value); touch() }} />
            </div>
            <Button className="h-auto min-h-12 w-full whitespace-normal py-2 text-base" onClick={toReview} disabled={!!busy || lines.length === 0}>
              {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Напред: преглед и изпращане<ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </section>

          <SupplierProducts key={supplier.id} supplier={supplier} inOrder={inOrder} onAdd={(p, hint) => addProduct(p, hint)} />
        </div>
      )}

      {step === 3 && supplier && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <section className="min-w-0 rounded-xl border bg-white p-4" aria-label="Както ще я види доставчикът">
            <SectionTitle className="mb-2">Така ще я види {supplier.name}</SectionTitle>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{preview}</pre>
            <PlanReview
              lines={lines.map(l => ({ name: l.product.name, quantity: parseQty(l.quantity) ?? 0, plan: planNumbers(l.plan) }))}
              stores={shopStores}
              warehouseName={warehouseName}
              onEdit={() => setStep(2)}
              units={split.units}
              share={sharePlan}
              onShare={v => { setSharePlan(v); touch() }}
              supplierName={supplier.name}
            />
          </section>
          <section className="min-w-0 space-y-3 rounded-xl border bg-white p-4" aria-label="Изпращане">
            <SectionTitle>Как да тръгне?</SectionTitle>
            {supplier.order_emails.length > 0 && mailReady ? (
              <Button className="h-auto w-full flex-col items-start gap-0.5 py-3 text-left" onClick={() => send('email')} disabled={!!busy}>
                <span className="flex items-center text-base">
                  {busy === 'email' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Изпрати по имейл
                </span>
                <span className="text-xs font-normal opacity-80 break-all">до {supplier.order_emails.join(', ')}. Копие отива и при вас.</span>
              </Button>
            ) : (
              <Note tone="warn">
                {supplier.order_emails.length === 0
                  ? <>{supplier.name} няма имейл за поръчки. Добавете го в <Link className="underline" href="/settings?tab=suppliers">Настройки → Доставчици</Link> или поръчайте по телефона и натиснете „Поръчах я сам“.</>
                  : <>Пощата на приложението не е настроена (<Link className="underline" href="/settings?tab=email">Настройки → Имейл</Link>). Поръчайте сами и натиснете „Поръчах я сам“.</>}
              </Note>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-auto min-h-10 whitespace-normal py-2" onClick={copyText} disabled={!!busy}>
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copied ? 'Копирано' : 'Копирай текста'}
              </Button>
              <Button variant="outline" className="h-auto min-h-10 whitespace-normal py-2" asChild disabled={!id}>
                <a href={id ? `/print/supplier-order/${id}` : '#'} target="_blank" rel="noreferrer"><Printer className="mr-2 h-4 w-4" />Печат</a>
              </Button>
            </div>
            <div className="border-t pt-3">
              <Hint small className="mb-2">Поръчахте по телефона, Viber или на хартия? Отбележете го, за да чака стоката в „Поръчки“.</Hint>
              <Button variant="secondary" className="w-full" onClick={() => {
                if (confirm(`Поръчахте ли ${formatOrderNumber(number)} от ${supplier.name} сами (телефон, Viber, хартия)?`)) void send('manual')
              }} disabled={!!busy}>
                {busy === 'manual' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Phone className="mr-2 h-4 w-4" />}Поръчах я сам
              </Button>
            </div>
            {supplier.phone && <Meta>Телефон на {supplier.contact_name || supplier.name}: <a className="underline" href={`tel:${supplier.phone}`}>{supplier.phone}</a></Meta>}
            <Button variant="ghost" className="w-full" onClick={() => setStep(2)} disabled={!!busy}>
              <ArrowLeft className="mr-2 h-4 w-4" />Промени продуктите
            </Button>
          </section>
        </div>
      )}
    </div>
  )
}

function SupplierStep({ suppliers, selected, onPick }: { suppliers: SupplierContact[]; selected: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const active = suppliers.filter(s => s.is_active)
  const shown = active.filter(s => s.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <section className="space-y-3" aria-label="Доставчик">
      <SectionTitle>От кого поръчваме?</SectionTitle>
      {active.length > 8 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Търси доставчик" className="pl-8 bg-white" autoFocus />
        </div>
      )}
      {active.length === 0 ? (
        <Empty className="rounded-lg border bg-white">
          Няма доставчици. Добавете ги в <Link className="underline" href="/settings?tab=suppliers">Настройки → Доставчици</Link>.
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(s => (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(s.id)}
                className={cn('w-full min-w-0 rounded-xl border bg-white p-3 text-left hover:border-primary hover:bg-primary/5', selected === s.id && 'border-primary ring-2 ring-primary/20')}
              >
                <span className="block truncate font-medium">{s.name}</span>
                <Meta as="span" className="block truncate">
                  {s.order_emails.length ? <><Mail className="mr-1 inline h-3 w-3" />{s.order_emails[0]}{s.order_emails.length > 1 ? ` +${s.order_emails.length - 1}` : ''}</> : 'без имейл: поръчва се по телефона'}
                </Meta>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SupplierProducts({ supplier, inOrder, onAdd }: {
  supplier: SupplierContact
  inOrder: Set<string>
  onAdd: (p: LineProduct, hint: number | null) => void
}) {
  const [items, setItems] = useState<SupplierProduct[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    // A new supplier remounts this list (key), so it starts empty.
    let alive = true
    fetch(`/api/supplier-orders/supplier-products?supplier_id=${supplier.id}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Не се заредиха')
        if (alive) setItems(data)
      })
      .catch(e => alive && setError(e.message))
    return () => { alive = false }
  }, [supplier.id])

  const needle = q.trim().toLowerCase()
  const shown = (items ?? []).filter(p => !needle || p.name.toLowerCase().includes(needle) || (p.sku ?? '').toLowerCase().includes(needle))

  return (
    <section className="min-w-0 space-y-2 rounded-xl border bg-white p-3 lg:order-1" aria-label="Обикновено взимаме">
      <SectionTitle count={items ? items.length : undefined}>Обикновено взимаме от {supplier.name}</SectionTitle>
      {items && items.length > 8 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Филтър" className="pl-8 bg-white" />
        </div>
      )}
      {error && <Note tone="danger">{error}</Note>}
      {!items && !error ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : items && items.length === 0 ? (
        <Empty>Още нищо не сме взимали от {supplier.name} през приложението. Потърсете продуктите в полето горе.</Empty>
      ) : (
        <ul className="max-h-[60vh] divide-y overflow-auto">
          {shown.map(p => {
            const added = inOrder.has(p.id)
            return (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <ProductThumb src={p.image} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 break-words text-sm" title={p.name}>{p.name}</div>
                  <div className={cn('text-xs', p.quantity_on_hand <= 0 ? 'text-red-600' : 'text-muted-foreground')}>
                    наличност {p.quantity_on_hand} бр.{p.last_qty ? ` · последно ${p.last_qty} бр.` : ''}
                    {p.status !== 'active' && <span className="ml-1 text-amber-700">(неактивен)</span>}
                  </div>
                </div>
                {added ? (
                  <span className="flex items-center gap-1 px-2 text-xs text-emerald-700"><Check className="h-3.5 w-3.5" />в поръчката</span>
                ) : (
                  <Button size="sm" variant="outline" aria-label={`Добави ${p.name}`} onClick={() => onAdd(p, p.last_qty)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * The split of one order line, folded to a line of text until opened: the same
 * fields as in a delivery, one per store, the rest to Офис.
 */
function LinePlan({ quantity, plan, open, stores, warehouseName, productName, onToggle, onChange }: {
  quantity: number
  plan: PlanText
  open: boolean
  stores: StoreOption[]
  warehouseName: string
  productName: string
  onToggle: () => void
  onChange: (plan: PlanText) => void
}) {
  const nums = planNumbers(plan)
  const over = overPlanned(quantity, nums)
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Разпределение на ${productName}`}
        className={cn('inline-flex items-center gap-1 text-left text-xs', over > 0 ? 'text-red-700' : 'text-slate-600 hover:text-slate-900')}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span>Разпределение: {planSummary(quantity, nums, stores, warehouseName)}</span>
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-slate-50 p-2">
          <PlanEditor quantity={quantity} stores={stores} warehouseName={warehouseName} plan={plan} onChange={onChange} />
        </div>
      )}
    </div>
  )
}

/** Step 3: the split, for us only (the supplier's text above has none of it). */
function PlanReview({ lines, stores, warehouseName, units, onEdit, share, onShare, supplierName }: {
  lines: { name: string; quantity: number; plan: Record<string, number> }[]
  stores: StoreOption[]
  warehouseName: string
  units: number
  onEdit: () => void
  share: boolean
  onShare: (v: boolean) => void
  supplierName: string
}) {
  return (
    <div className="mt-4 border-t pt-3" data-testid="order-plan-review">
      <SectionTitle className="mb-1">Разпределение по магазини</SectionTitle>
      <Hint small className="mb-2">
        {share
          ? 'Доставчикът ще го види в поръчката, за да опакова отделно за всеки обект. '
          : 'Само за вас: доставчикът не го вижда. '}
        Когато стоката дойде, доставката ще е разпределена така. Може да го смените и след изпращане.
      </Hint>
      {units > 0 && (
        <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border bg-slate-50 p-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={share} onChange={e => onShare(e.target.checked)} />
          <span>
            <span className="font-medium">Прати разпределението и на {supplierName}</span>
            <span className="block text-xs text-muted-foreground">В имейла и на печат: за всеки продукт колко за кой обект и общо, за да опакова поотделно.</span>
          </span>
        </label>
      )}
      {units === 0 ? (
        <Note tone="warn">
          Нищо не е разпределено: всичко ще остане в {warehouseName}.{' '}
          <button type="button" className="underline" onClick={onEdit}>Разпредели по магазини</button>
        </Note>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((l, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{l.name}</span>
              <span className="text-muted-foreground">{planSummary(l.quantity, l.plan, stores, warehouseName)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
