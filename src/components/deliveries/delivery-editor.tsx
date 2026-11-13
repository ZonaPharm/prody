'use client'

import type { LabelKind } from '@/lib/label-kind'
import { LabelKindSelect } from './label-kind-select'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, Coins, FileText, Hash, Loader2, Package, Plus, Store, Tag, Trash2, Truck, type LucideIcon } from 'lucide-react'
import type { DeliveryProduct } from '@/lib/deliveries/products'
import {
  draftTotals,
  lineMissing,
  lineOverPlanned,
  lineProblem,
  parseMoney,
  parseQty,
  saveBlocker,
  toDraftPayload,
  type DraftHeaderState,
  type DraftLineState,
} from '@/lib/deliveries/draft'
import { formatMoney } from '@/lib/deliveries/format'
import { planSummary } from '@/lib/deliveries/plan'
import { sofiaTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { ProductPicker, ProductThumb } from './product-picker'
import { CatalogDialog } from './catalog-dialog'
import { NewProductDialog } from './new-product-dialog'
import { SupplierSelect, type SupplierOption } from './supplier-select'
import { PlanEditor, planNumbers } from './plan-editor'
import { Hint, Note, PageHeader, SectionTitle } from '@/components/ui/text'
import { compareWithOrder, diffSentence, formatOrderNumber, type OrderedLine } from '@/lib/supplier-orders/format'

/** The order this draft delivery was made from ("Пристигна"), to check what came against it. */
export type FromOrder = { id: string; number: number; lines: OrderedLine[] }

type StoreOption = { id: string; name: string; is_warehouse: boolean }
type Option = { id: string; name: string }

export type DraftInitial = {
  id: string
  updated_at: string
  header: DraftHeaderState
  lines: DraftLineState[]
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'incomplete'; message: string }
  | { kind: 'error'; message: string; fatal: boolean }

let keySeq = 0
function newKey() {
  keySeq += 1
  return `k${Date.now().toString(36)}${keySeq}`
}

/**
 * The draft of a delivery. Products go in row by row: under the last row there
 * is always an empty one to click and pick the next product (search, the
 * catalogue with ticks, or a new product); an empty row left as it is means
 * there are no more. Supplier and cost fill in from the product's last
 * delivery; the plan per store opens right under the line. Everything autosaves as one draft
 * (no stock moves); "Запиши доставката" gives it a number and it waits for receiving.
 */
export function DeliveryEditor({
  initial,
  stores,
  suppliers: initialSuppliers,
  categories,
  fromOrder = null,
}: {
  initial: DraftInitial | null
  stores: StoreOption[]
  suppliers: SupplierOption[]
  categories: Option[]
  fromOrder?: FromOrder | null
}) {
  const router = useRouter()
  const warehouse = stores.find(s => s.is_warehouse)
  const shopStores = useMemo(() => stores.filter(s => !s.is_warehouse), [stores])
  const warehouseName = warehouse?.name ?? 'Офис'

  const [deliveryId, setDeliveryId] = useState<string | null>(initial?.id ?? null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial?.updated_at ?? null)
  const [header, setHeader] = useState<DraftHeaderState>(initial?.header ?? { order_ref: '', notes: '' })
  const [lines, setLines] = useState<DraftLineState[]>(initial?.lines ?? [])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(initialSuppliers)
  const orderedQty = useMemo(() => new Map((fromOrder?.lines ?? []).map(o => [o.product_id, o.quantity])), [fromOrder])
  const orderDiff = useMemo(
    () => fromOrder
      ? compareWithOrder(fromOrder.lines, lines.map(l => ({ product_id: l.product.id, name: l.product.name, quantity: parseQty(l.quantity) ?? 0 })))
      : null,
    [fromOrder, lines],
  )
  const [defaultSupplier, setDefaultSupplier] = useState<string | null>(null)
  const [defaultDoc, setDefaultDoc] = useState('')
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState('')

  // Autosave bookkeeping: every edit bumps the version; a save remembers the
  // version it carried, and saves again if more edits came in meanwhile.
  const version = useRef(0)
  const savedVersion = useRef(0)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The save reads the latest committed state, not the state of the render
  // that scheduled it.
  const stateRef = useRef({ deliveryId, updatedAt, header, lines })
  useLayoutEffect(() => {
    stateRef.current = { deliveryId, updatedAt, header, lines }
  })
  const fatal = save.kind === 'error' && save.fatal

  const touch = useCallback(() => {
    version.current += 1
    setSave(s => (s.kind === 'error' && s.fatal ? s : { kind: 'pending' }))
  }, [])

  // Whether the editor is still on screen; a save that ends after the person
  // left must not rewrite the address bar.
  const mounted = useRef(false)

  const doSave = useCallback(async (): Promise<boolean> => {
    // One save at a time: two in parallel would race on updated_at and could
    // create two drafts. Several callers may be waiting; each checks again.
    let waited = false
    while (inFlight.current) {
      waited = true
      await inFlight.current
    }
    if (waited && savedVersion.current === version.current) return true
    const { deliveryId: id, updatedAt: seen, header: h, lines: ls } = stateRef.current
    const blocker = ls.map(lineProblem).findIndex(p => p != null)
    if (blocker >= 0) {
      setSave({ kind: 'incomplete', message: `Ред ${blocker + 1}: липсва ${lineProblem(ls[blocker])}` })
      return false
    }
    if (!id && ls.length === 0 && !h.order_ref.trim() && !h.notes.trim()) {
      setSave({ kind: 'idle' })
      return true
    }
    const carried = version.current
    const run = (async () => {
      setSave({ kind: 'saving' })
      try {
        const res = await fetch('/api/deliveries/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, expected_updated_at: seen, draft: toDraftPayload(h, ls) }),
        })
        const data = await res.json()
        if (!res.ok) {
          const conflict = /променена от друг/.test(data.error || '') || /вече не е чернова/.test(data.error || '')
          setSave({ kind: 'error', message: data.error || 'Черновата не се запази', fatal: conflict })
          return false
        }
        const ids = new Map<string, string>((data.items ?? []).map((x: { key: string; id: string }) => [x.key, x.id]))
        // The answer is authoritative for every line it carried. stateRef is
        // updated too, so a save queued behind this one sends the new ids even
        // before React has re-rendered.
        const withIds = (ls2: DraftLineState[]) => ls2.map(l => (ids.has(l.key) ? { ...l, id: ids.get(l.key)! } : l))
        stateRef.current.lines = withIds(stateRef.current.lines)
        setLines(withIds)
        stateRef.current.updatedAt = data.updated_at
        setUpdatedAt(data.updated_at)
        if (!id) {
          stateRef.current.deliveryId = data.id
          setDeliveryId(data.id)
          if (mounted.current && window.location.pathname === '/deliveries/new') {
            window.history.replaceState(null, '', `/deliveries/${data.id}`)
          }
        }
        savedVersion.current = carried
        setSave(version.current === carried ? { kind: 'saved', at: new Date() } : { kind: 'pending' })
        return true
      } catch {
        setSave({ kind: 'error', message: 'Няма връзка. Ще опитам пак при следваща промяна.', fatal: false })
        return false
      } finally {
        inFlight.current = null
      }
    })()
    inFlight.current = run
    return run
  }, [])

  // Debounced autosave after each edit.
  useEffect(() => {
    if (save.kind !== 'pending' || fatal) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void doSave() }, 1200)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [save, lines, header, doSave, fatal])

  // Leaving the screen inside the app (a menu link) does not fire
  // beforeunload: save what is pending right away instead.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      if (version.current !== savedVersion.current) void doSave()
    }
  }, [doSave])

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (version.current !== savedVersion.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  function updateLine(key: string, patch: Partial<DraftLineState>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
    touch()
  }

  /** "Етикет" belongs to the product, so every line of that product follows. */
  function setLabelKind(productId: string, kind: LabelKind) {
    setLines(prev => prev.map(l => (l.product.id === productId ? { ...l, label_kind: kind, needs_label: kind === 'full', label_changed: true } : l)))
    touch()
  }

  function addProducts(products: DeliveryProduct[]) {
    if (!products.length) return
    // A product already on the draft keeps the "Етикет" choice made there.
    const changed = new Map(lines.filter(l => l.label_changed).map(l => [l.product.id, l.label_kind]))
    const added: DraftLineState[] = products.map(p => ({
      key: newKey(),
      id: null,
      product: { id: p.id, name: p.name, sku: p.sku, image: p.image, status: p.status, price: p.price },
      supplier_id: defaultSupplier ?? p.suggested.supplier_id,
      doc_number: defaultDoc,
      quantity: '',
      pack_size: p.suggested.pack_size > 1 ? String(p.suggested.pack_size) : '',
      unit_cost: p.suggested.unit_cost != null ? String(p.suggested.unit_cost).replace('.', ',') : '',
      label_kind: changed.get(p.id) ?? p.label_kind,
      needs_label: (changed.get(p.id) ?? p.label_kind) === 'full',
      label_changed: changed.has(p.id),
      plan: {},
    }))
    setLines(prev => [...prev, ...added])
    setOpenKeys(prev => new Set([...prev, ...added.map(a => a.key)]))
    setFocusKey(added[0].key)
    touch()
  }

  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key))
    touch()
  }

  /** Enter moves on: Бройки → Цена → the empty row for the next product. */
  function focusField(key: string, field: 'cost') {
    document.querySelector<HTMLInputElement>(`[data-line="${key}"] [data-field="${field}"]`)?.focus()
  }
  function focusNextRow() {
    document.querySelector<HTMLInputElement>('[data-testid="delivery-empty-row"] input')?.focus()
  }

  function toggleOpen(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function applyDefaultsToAll() {
    setLines(prev => prev.map(l => ({
      ...l,
      supplier_id: defaultSupplier ?? l.supplier_id,
      doc_number: defaultDoc.trim() ? defaultDoc : l.doc_number,
    })))
    touch()
  }

  async function finish() {
    setFinishing(true)
    setFinishError('')
    try {
      if (timer.current) clearTimeout(timer.current)
      const ok = await doSave()
      const id = stateRef.current.deliveryId
      if (!ok || !id) throw new Error('Черновата не се запази. Вижте съобщението горе.')
      const res = await fetch(`/api/deliveries/${id}/save`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Доставката не можа да се запише')
      savedVersion.current = version.current
      router.push(`/deliveries/${id}`)
      router.refresh()
    } catch (e: any) {
      setFinishError(e.message)
      setFinishing(false)
    }
  }

  async function discard() {
    // Let a save that is on its way finish first, so its draft is the one cancelled.
    if (timer.current) clearTimeout(timer.current)
    while (inFlight.current) await inFlight.current
    const id = stateRef.current.deliveryId
    if (!id) {
      savedVersion.current = version.current // nothing to keep
      router.push('/deliveries')
      return
    }
    setFinishing(true)
    try {
      const res = await fetch(`/api/deliveries/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Изтрита чернова' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Черновата не можа да се изтрие')
      savedVersion.current = version.current
      router.push('/deliveries')
      router.refresh()
    } catch (e: any) {
      setFinishError(e.message)
      setFinishing(false)
      setDiscardOpen(false)
    }
  }

  const totals = draftTotals(lines)
  const blocker = saveBlocker(lines)
  const productCount = new Map<string, number>()
  for (const l of lines) productCount.set(l.product.id, (productCount.get(l.product.id) ?? 0) + 1)
  const inDelivery = new Set(lines.map(l => l.product.id))

  return (
    <div className="space-y-4 max-w-7xl pb-36 sm:pb-24">
      <PageHeader
        back={<Button asChild variant="ghost" size="icon"><Link href="/deliveries" aria-label="Назад"><ArrowLeft className="h-4 w-4" /></Link></Button>}
        title={deliveryId ? 'Чернова на доставка' : 'Нова доставка'}
        intro="Черновата се пази сама и не променя наличностите."
        actions={<SaveIndicator state={save} />}
      />

      {fatal && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between gap-3">
          <span>{(save as { message: string }).message}</span>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Презареди</Button>
        </div>
      )}

      <section className="rounded-lg border bg-white p-4 grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="inline-flex items-center gap-1.5"><Truck className="h-4 w-4 text-slate-500" />Доставчик за новите редове</Label>
          <SupplierSelect
            value={defaultSupplier}
            suppliers={suppliers}
            onChange={setDefaultSupplier}
            onCreated={s => setSuppliers(prev => [...prev, s].sort((a, b) => a.name.localeCompare(b.name, 'bg')))}
            className="w-full"
            placeholder="— по продукта —"
            ariaLabel="Доставчик за новите редове"
            disabled={fatal}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-doc" className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4 text-slate-500" />Фактура № за новите редове</Label>
          <Input id="d-doc" value={defaultDoc} onChange={e => setDefaultDoc(e.target.value)} placeholder="напр. 0000123456" disabled={fatal} />
          {lines.length > 0 && (defaultSupplier || defaultDoc.trim()) && (
            <button type="button" className="text-xs text-blue-700 hover:underline" onClick={applyDefaultsToAll}>
              Приложи към всички редове
            </button>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-order">Поръчка № (по избор)</Label>
          <Input id="d-order" value={header.order_ref} disabled={fatal}
            onChange={e => { setHeader(h => ({ ...h, order_ref: e.target.value })); touch() }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="d-notes">Бележка</Label>
          <Input id="d-notes" value={header.notes} disabled={fatal}
            onChange={e => { setHeader(h => ({ ...h, notes: e.target.value })); touch() }} />
        </div>
      </section>

      {fromOrder && orderDiff && (
        <section className="space-y-2 rounded-lg border bg-white p-4" aria-label="Сверете с фактурата">
          <SectionTitle>
            От поръчка <Link className="underline" href={`/deliveries/orders/${fromOrder.id}`}>{formatOrderNumber(fromOrder.number)}</Link>: сверете с фактурата
          </SectionTitle>
          <Note tone={orderDiff.same ? 'success' : 'warn'}>
            {diffSentence(orderDiff)}
            {orderDiff.missing.length > 0 && (
              <span className="block text-xs">Не са в доставката: {orderDiff.missing.map(m => `${m.name} (${m.quantity} бр.)`).join(', ')}</span>
            )}
          </Note>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-sky-800 marker:text-sky-500">
            <li>Поправете бройките, които са дошли различно (до всеки ред пише колко сме поръчали).</li>
            <li>Махнете с кошчето каквото не е дошло.</li>
            <li>Добавете дошлото извън поръчката: търсене, „Каталог“ или „Нов продукт“ отдолу.</li>
            <li>Сложете цените и номера от фактурата, разпределете по магазини и запазете.</li>
          </ol>
        </section>
      )}

      <section className="rounded-lg border bg-white">
        <div className="divide-y">
          {lines.map((l, idx) => {
            const qty = parseQty(l.quantity) ?? 0
            const cost = parseMoney(l.unit_cost)
            const problem = lineProblem(l)
            const missing = lineMissing(l)
            const over = lineOverPlanned(l)
            const isOpen = openKeys.has(l.key)
            const dup = (productCount.get(l.product.id) ?? 0) > 1
            const costAbovePrice = cost != null && l.product.price != null && cost > l.product.price
            const done = missing.length === 0 && over === 0
            return (
              <div key={l.key} data-line={l.key} className={cn('p-3 space-y-2', over > 0 && 'bg-red-50/40')} data-testid="delivery-line">
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={cn(
                      'mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                      done ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800',
                    )}
                    title={done ? 'Редът е попълнен' : `Попълнете: ${missing.join(', ') || 'разпределението'}`}
                  >
                    {done ? <Check className="h-4 w-4" aria-label={`Ред ${idx + 1} е попълнен`} /> : idx + 1}
                  </span>
                  <ProductThumb src={l.product.image} size={40} />
                  <div className="min-w-[180px] flex-1">
                    <div className="font-medium leading-tight">{l.product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.product.sku ? `${l.product.sku} · ` : ''}продажна {formatMoney(l.product.price)}
                      {l.product.status !== 'active' && <span className="ml-1 text-amber-700">(неактивен)</span>}
                      {dup && <span className="ml-1 text-amber-700">· продуктът е на повече от един ред</span>}
                    </div>
                    {fromOrder && (() => {
                      const ordered = orderedQty.get(l.product.id)
                      if (ordered == null) return <div className="text-xs font-medium text-blue-800">извън поръчката</div>
                      const came = orderDiff?.changed.find(c => c.product_id === l.product.id)
                      return (
                        <div className={cn('text-xs font-medium', came ? 'text-amber-700' : 'text-slate-600')}>
                          поръчани: {ordered} бр.{came ? ` · дошли общо ${came.came}` : ''}
                        </div>
                      )
                    })()}
                    {fromOrder && cost === 0 && (
                      <div className="text-xs text-amber-700">Цената е 0: сложете я от фактурата</div>
                    )}
                    {missing.length > 0 && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                        <AlertTriangle className="h-3 w-3" aria-hidden />Попълнете: {missing.join(', ')}
                      </div>
                    )}
                    <label className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <Tag className="h-3.5 w-3.5 text-slate-500" />Етикет
                      <LabelKindSelect compact value={l.label_kind} disabled={fatal} onChange={k => setLabelKind(l.product.id, k)} />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field icon={Truck} label="Доставчик">
                      <SupplierSelect
                        value={l.supplier_id}
                        suppliers={suppliers}
                        onChange={id => updateLine(l.key, { supplier_id: id })}
                        onCreated={s => setSuppliers(prev => [...prev, s].sort((a, b) => a.name.localeCompare(b.name, 'bg')))}
                        className="w-40"
                        ariaLabel={`Доставчик на ред ${idx + 1}`}
                        disabled={fatal}
                      />
                    </Field>
                    <Field icon={FileText} label="Фактура №">
                      <Input className="h-9 w-32 bg-white" value={l.doc_number} disabled={fatal}
                        onChange={e => updateLine(l.key, { doc_number: e.target.value })} />
                    </Field>
                    <Field icon={Hash} label="Бройки">
                      <Input
                        className={cn('h-9 w-20 bg-white', problem === 'количество' && l.quantity !== '' && 'border-red-500', l.quantity === '' && 'border-amber-400')}
                        inputMode="numeric"
                        enterKeyHint="next"
                        autoFocus={focusKey === l.key}
                        aria-label={`Бройки на ред ${idx + 1}`}
                        value={l.quantity}
                        disabled={fatal}
                        onChange={e => updateLine(l.key, { quantity: e.target.value.replace(/[^0-9]/g, '') })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusField(l.key, 'cost') } }}
                      />
                    </Field>
                    <Field icon={Package} label="В кутия" title="Колко бройки има в една кутия (по избор)">
                      <Input className="h-9 w-16 bg-white" inputMode="numeric" placeholder="1" value={l.pack_size} disabled={fatal}
                        aria-label={`Бройки в кутия на ред ${idx + 1}`}
                        onChange={e => updateLine(l.key, { pack_size: e.target.value.replace(/[^0-9]/g, '') })} />
                    </Field>
                    <Field icon={Coins} label="Цена/бр. с ДДС">
                      <Input
                        className={cn('h-9 w-24 bg-white', problem === 'доставна цена' && l.unit_cost !== '' && 'border-red-500', l.unit_cost === '' && 'border-amber-400')}
                        inputMode="decimal"
                        enterKeyHint="next"
                        data-field="cost"
                        aria-label={`Доставна цена на ред ${idx + 1}`}
                        value={l.unit_cost}
                        disabled={fatal}
                        onChange={e => updateLine(l.key, { unit_cost: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); focusNextRow() } }}
                      />
                    </Field>
                    <div className="flex flex-col text-xs text-slate-600">
                      Сума
                      <span className="h-9 flex items-center text-sm tabular-nums">{formatMoney(qty * (cost ?? 0))}</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Махни ред ${idx + 1}`} title="Махни реда" disabled={fatal}
                      onClick={() => removeLine(l.key)}>
                      <Trash2 className="h-4 w-4 text-slate-500" />
                    </Button>
                  </div>
                </div>
                {costAbovePrice && (
                  <p className="ml-10 text-xs text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />Доставната цена е над продажната ({formatMoney(l.product.price)}).
                  </p>
                )}
                <div className="ml-10">
                  <button type="button" onClick={() => toggleOpen(l.key)}
                    className={cn('inline-flex items-center gap-1 text-xs', over > 0 ? 'text-red-700' : 'text-slate-600 hover:text-slate-900')}>
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <Store className="h-3.5 w-3.5" />
                    Разпределение: {planSummary(qty, planNumbers(l.plan), shopStores, warehouseName)}
                  </button>
                  {isOpen && (
                    <div className="mt-2 rounded-md bg-slate-50 p-2">
                      <PlanEditor
                        quantity={qty}
                        stores={shopStores}
                        warehouseName={warehouseName}
                        plan={l.plan}
                        onChange={plan => updateLine(l.key, { plan })}
                        disabled={fatal}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* The next row: always there, empty until a product is picked. Left empty = no more products. */}
          <div className="p-3" data-testid="delivery-empty-row">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/60 p-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-300" title={`Ред ${lines.length + 1}`}>
                <Plus className="h-4 w-4" />
              </span>
              <div className="min-w-[220px] flex-1">
                <ProductPicker
                  onPick={p => addProducts([p])}
                  disabled={fatal}
                  scrollOnFocus
                  placeholder={`Ред ${lines.length + 1}: изберете продукт (име, код, баркод)`}
                />
              </div>
              <CatalogDialog categories={categories} stores={shopStores.concat(warehouse ? [warehouse] : [])} inDelivery={inDelivery} onAdd={addProducts} disabled={fatal} />
              <NewProductDialog categories={categories} supplierId={defaultSupplier} onCreated={p => addProducts([p])} disabled={fatal} />
            </div>
            <Hint small className="mt-1.5 ml-1">
              {lines.length === 0
                ? 'Започнете оттук: изберете първия продукт. С „Каталог“ може да отметнете няколко наведнъж: всеки става отделен ред.'
                : 'Следващ продукт? Изберете го тук. Няма повече: оставете този ред празен.'}
            </Hint>
          </div>
        </div>
      </section>

      <div className="fixed bottom-[var(--bottom-nav-h)] left-0 right-0 lg:left-56 border-t bg-white/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-7xl flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="text-sm tabular-nums">
            <span className="font-medium">{totals.lines}</span> реда · <span className="font-medium">{totals.units}</span> бр. · <span className="font-medium">{formatMoney(totals.value)}</span>
          </div>
          {blocker && lines.length > 0 && <span className="text-xs text-amber-700">{blocker}</span>}
          {finishError && <span className="text-xs text-red-600">{finishError}</span>}
          <div className="ml-auto flex w-full gap-2 sm:w-auto">
            <Button type="button" variant="ghost" className="px-3" onClick={() => setDiscardOpen(true)} disabled={finishing || fatal}>
              <span className="sm:hidden">Изтрий</span><span className="hidden sm:inline">Изтрий черновата</span>
            </Button>
            <Button type="button" className="flex-1 sm:flex-none" onClick={() => setConfirmOpen(true)} disabled={!!blocker || finishing || fatal}>
              {finishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Запиши доставката
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Запис на доставката</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>{totals.lines} реда, {totals.units} бр., {formatMoney(totals.value)}.</p>
            <Note>
              Доставката получава номер и чака получаване. Редовете вече не се променят; разпределението може да се сменя и след това.
              Наличностите се променят чак при получаването.
            </Note>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Назад</Button>
            <Button onClick={() => { setConfirmOpen(false); void finish() }}>Запиши</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Изтриване на черновата</DialogTitle></DialogHeader>
          <Note>Черновата отива в „Отказани“, с запис в дневника. Наличностите не се променят.</Note>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDiscardOpen(false)}>Назад</Button>
            <Button variant="destructive" onClick={() => void discard()} disabled={finishing}>Изтрий</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ icon: Icon, label, title, children }: { icon: LucideIcon; label: string; title?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col text-xs font-medium text-slate-700" title={title}>
      <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5 text-slate-500" />{label}</span>
      {children}
    </label>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  switch (state.kind) {
    case 'saving':
      return <span className="text-xs text-slate-500 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Запазване…</span>
    case 'pending':
      return <span className="text-xs text-slate-500">Има незапазени промени…</span>
    case 'saved':
      return <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><Check className="h-3 w-3" />Запазено {sofiaTime(state.at)}</span>
    case 'incomplete':
      return <span className="text-xs text-amber-700">Не е запазено: {state.message}</span>
    case 'error':
      return state.fatal ? null : <span className="text-xs text-red-600">{state.message}</span>
    default:
      return null
  }
}
