'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Download, FileText, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Hint, Meta, Note } from '@/components/ui/text'
import { LABEL_KINDS, LABEL_KIND_LABEL } from '@/lib/label-kind'
import { PRODUCT_FIELDS, fieldValueText, type ActionCard, type ProductField } from '@/lib/assistant/cards'
import { cn } from '@/lib/utils'

const euro = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(2).replace('.', ',')} €`)
const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')))

const CONFIRM_LABEL: Record<string, string> = {
  delivery_draft: 'Създай чернова на доставка',
  supplier_order: 'Създай чернова на поръчка',
  product_create: 'Създай продукта',
  product_update: 'Запиши промените',
}

/**
 * A proposal from the assistant (or a file it made), shown under its answer.
 * The person can correct quantities and prices, take rows out, then confirm.
 * Nothing is saved before the button.
 */
export function ActionCardView({ card: initial }: { card: ActionCard }) {
  const [card, setCard] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (card.kind === 'excel' || card.kind === 'document') return <FileCard card={card} />

  async function decide(decision: 'confirm' | 'dismiss', payload?: unknown) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/assistant/actions/${card.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.card) setCard(data.card)
      if (!res.ok) setError(data.error || 'Не стана. Опитайте пак.')
    } catch {
      setError('Няма връзка. Опитайте пак.')
    } finally {
      setBusy(false)
    }
  }

  const open = card.status === 'proposed'
  return (
    <div className={cn('rounded-lg border bg-white p-3 text-sm shadow-sm', open ? 'border-violet-300' : 'border-slate-200')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-semibold">{card.title}</p>
        {card.status === 'done' && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Записано</span>}
        {card.status === 'dismissed' && <span className="shrink-0 text-xs text-slate-500">Отказано</span>}
      </div>
      {card.kind === 'delivery_draft' && <DeliveryBody card={card} open={open} busy={busy} onConfirm={p => decide('confirm', p)} />}
      {card.kind === 'supplier_order' && <OrderBody card={card} open={open} busy={busy} onConfirm={p => decide('confirm', p)} />}
      {card.kind === 'product_create' && <NewProductBody card={card} open={open} busy={busy} onConfirm={p => decide('confirm', p)} />}
      {card.kind === 'product_update' && <ChangeBody card={card} open={open} busy={busy} onConfirm={p => decide('confirm', p)} />}
      {error && <Note tone="danger" small className="mt-2">{error}</Note>}
      {open && (
        <button type="button" onClick={() => decide('dismiss')} disabled={busy} className="mt-2 text-xs text-slate-500 underline disabled:opacity-50">
          Не го искам
        </button>
      )}
      {card.status === 'done' && card.result && (
        <div className="mt-2 space-y-1">
          {card.result.text && <Note tone="success" small>{card.result.text}</Note>}
          {card.result.url && <Link href={card.result.url} className="inline-block text-sm font-medium text-violet-700 underline">{card.result.label || 'Отвори'}</Link>}
        </div>
      )}
    </div>
  )
}

function ConfirmButton({ kind, busy, disabled, onClick }: { kind: string; busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="sm" className="mt-3 w-full sm:w-auto" disabled={busy || disabled} onClick={onClick}>
      {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{CONFIRM_LABEL[kind]}
    </Button>
  )
}

type BodyProps = { card: ActionCard; open: boolean; busy: boolean; onConfirm: (payload: unknown) => void }

type Line = { keep: boolean; product_id: string | null; name: string; isNew: boolean; sale?: number; last?: number | null; doc?: string | null; qty: string; cost: string; raw: any }

function DeliveryBody({ card, open, busy, onConfirm }: BodyProps) {
  const p = card.payload
  const [lines, setLines] = useState<Line[]>(() => (p.lines || []).map((l: any) => ({
    keep: true,
    product_id: l.product_id,
    name: l.product_name || l.new_product?.name || '?',
    isNew: !!l.new_product,
    sale: l.new_product?.sale_price,
    last: l.last_cost,
    doc: l.doc_text,
    qty: String(l.quantity),
    cost: String(l.unit_cost),
    raw: l,
  })))
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const kept = lines.filter(l => l.keep)
  const bad = kept.some(l => !(num(l.qty) >= 1 && Number.isInteger(num(l.qty))) || !(num(l.cost) >= 0))
  const total = kept.reduce((s, l) => s + (num(l.qty) || 0) * (num(l.cost) || 0), 0)
  const confirmed = card.payload.confirmed

  return (
    <>
      <Meta>
        {p.supplier_name ? `Доставчик: ${p.supplier_name}` : 'Без доставчик (изберете го в черновата)'}
        {p.document_number ? ` · Документ ${p.document_number}` : ''}
      </Meta>
      {open && <Hint small className="mt-2">Проверете бройките и доставните цени с ДДС. Махнете отметката на ред, който не трябва.</Hint>}
      <ul className="mt-2 divide-y rounded-md border">
        {lines.map((l, i) => (
          <li key={i} className={cn('space-y-1 px-2 py-2', !l.keep && 'opacity-50')}>
            <div className="flex items-start gap-2">
              {open && <Checkbox checked={l.keep} onCheckedChange={v => set(i, { keep: v === true })} aria-label="Включи реда" className="mt-0.5" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {l.isNew && <span className="mr-1 rounded bg-amber-100 px-1 text-xs text-amber-800">нов</span>}
                  {l.name}
                </p>
                {l.doc && <p className="truncate text-xs text-slate-500">В документа: {l.doc}</p>}
                {l.isNew && <p className="text-xs text-slate-500">Продажна цена {euro(l.sale)}</p>}
                {!l.isNew && l.last != null && <p className="text-xs text-slate-500">Последна доставна {euro(l.last)}</p>}
              </div>
            </div>
            {open ? (
              <div className="flex items-center gap-2 pl-6 text-xs">
                <Input inputMode="numeric" value={l.qty} onChange={e => set(i, { qty: e.target.value })} className="h-8 w-20 text-right" aria-label="Брой" />
                <span>бр. ×</span>
                <Input inputMode="decimal" value={l.cost} onChange={e => set(i, { cost: e.target.value })} className="h-8 w-24 text-right" aria-label="Доставна цена с ДДС" />
                <span>€ с ДДС</span>
              </div>
            ) : (
              <p className="pl-1 text-xs tabular-nums">{l.qty} бр. × {euro(num(l.cost))}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-sm">Общо: <span className="font-semibold tabular-nums">{euro(total)}</span>{open && kept.length !== lines.length ? ` (${kept.length} от ${lines.length} реда)` : ''}</p>
      {open && (
        <ConfirmButton kind={card.kind} busy={busy} disabled={!kept.length || bad} onClick={() => onConfirm({
          supplier_id: p.supplier_id ?? null,
          document_number: p.document_number ?? null,
          notes: p.notes ?? null,
          lines: kept.map(l => ({
            product_id: l.product_id || null,
            new_product: l.isNew ? l.raw.new_product : null,
            quantity: num(l.qty),
            unit_cost: num(l.cost),
          })),
        })} />
      )}
      {!open && confirmed && <Meta className="mt-1">Потвърдени {confirmed.lines?.length ?? 0} реда.</Meta>}
    </>
  )
}

function OrderBody({ card, open, busy, onConfirm }: BodyProps) {
  const p = card.payload
  const [lines, setLines] = useState(() => (p.lines || []).map((l: any) => ({ ...l, keep: true, qty: String(l.quantity) })))
  const kept = lines.filter((l: any) => l.keep)
  const bad = kept.some((l: any) => !(num(l.qty) >= 1 && Number.isInteger(num(l.qty))))
  return (
    <>
      <Meta>Доставчик: {p.supplier_name}. Черновата не се изпраща сама: пращате я от „Поръчки“.</Meta>
      <ul className="mt-2 divide-y rounded-md border">
        {lines.map((l: any, i: number) => (
          <li key={i} className={cn('flex items-center gap-2 px-2 py-2', !l.keep && 'opacity-50')}>
            {open && <Checkbox checked={l.keep} onCheckedChange={v => setLines((ls: any[]) => ls.map((x, j) => (j === i ? { ...x, keep: v === true } : x)))} aria-label="Включи реда" />}
            <span className="min-w-0 flex-1">{l.product_name}{l.note ? <span className="block text-xs text-slate-500">{l.note}</span> : null}</span>
            {open
              ? <Input inputMode="numeric" value={l.qty} onChange={e => setLines((ls: any[]) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="h-8 w-20 text-right" aria-label="Брой" />
              : <span className="tabular-nums">{l.qty} бр.</span>}
          </li>
        ))}
      </ul>
      {open && (
        <ConfirmButton kind={card.kind} busy={busy} disabled={!kept.length || bad} onClick={() => onConfirm({
          supplier_id: p.supplier_id,
          notes: p.notes ?? null,
          lines: kept.map((l: any) => ({ product_id: l.product_id, quantity: num(l.qty), note: l.note ?? null })),
        })} />
      )}
    </>
  )
}

function NewProductBody({ card, open, busy, onConfirm }: BodyProps) {
  const p = card.payload.product
  const [name, setName] = useState<string>(p.name)
  const [price, setPrice] = useState<string>(String(p.price))
  const [cost, setCost] = useState<string>(p.cost_price == null ? '' : String(p.cost_price))
  const [barcode, setBarcode] = useState<string>(p.barcode ?? '')
  const [labelKind, setLabelKind] = useState<string>(p.label_kind)
  const bad = name.trim().length < 2 || !(num(price) > 0) || (cost.trim() !== '' && !(num(cost) >= 0))
  const row = (label: string, el: React.ReactNode) => (
    <label className="grid grid-cols-[8rem_1fr] items-center gap-2"><span className="text-xs text-slate-600">{label}</span>{el}</label>
  )
  return (
    <>
      {card.payload.warning && <Note tone="warn" small className="mb-2">{card.payload.warning}</Note>}
      {open ? (
        <div className="space-y-2">
          {row('Име', <Input value={name} onChange={e => setName(e.target.value)} className="h-8" />)}
          {row('Продажна цена €', <Input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} className="h-8 w-28" />)}
          {row('Доставна с ДДС €', <Input inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} className="h-8 w-28" />)}
          {row('Фабричен баркод', <Input value={barcode} onChange={e => setBarcode(e.target.value)} className="h-8 font-mono" />)}
          {row('Етикет', (
            <select value={labelKind} onChange={e => setLabelKind(e.target.value)} className="h-8 rounded-md border bg-white px-2 text-sm">
              {LABEL_KINDS.map(k => <option key={k} value={k}>{LABEL_KIND_LABEL[k]}</option>)}
            </select>
          ))}
          <Meta>
            {[p.category_name && `Категория: ${p.category_name}`, p.supplier_name && `Доставчик: ${p.supplier_name}`, `Минимум: ${p.min_quantity}`].filter(Boolean).join(' · ')}.
            Наличност 0: стоката идва с доставка.
          </Meta>
        </div>
      ) : (
        <Meta>{p.name} · {euro(p.price)}</Meta>
      )}
      {open && (
        <ConfirmButton kind={card.kind} busy={busy} disabled={bad} onClick={() => onConfirm({
          product: {
            ...p, name: name.trim(), price: num(price), cost_price: cost.trim() === '' ? null : num(cost),
            barcode: barcode.trim() || null, label_kind: labelKind,
          },
        })} />
      )}
    </>
  )
}

function ChangeBody({ card, open, busy, onConfirm }: BodyProps) {
  const diff: Partial<Record<ProductField, [any, any]>> = card.payload.diff || {}
  const names: Record<string, string> = card.payload.names || {}
  const fields = Object.keys(diff) as ProductField[]
  const [keep, setKeep] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.map(f => [f, true])))
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f, diff[f]![1] == null ? '' : String(diff[f]![1])])))
  const editable = (f: ProductField) => ['name', 'price', 'cost_price', 'min_quantity', 'barcode', 'description'].includes(f)
  const valueOf = (f: ProductField): unknown => {
    if (!editable(f)) return diff[f]![1]
    const v = values[f]
    if (f === 'price' || f === 'cost_price') return v.trim() === '' && f === 'cost_price' ? null : num(v)
    if (f === 'min_quantity') return num(v)
    return v.trim() === '' && f !== 'name' ? null : v.trim()
  }
  const chosen = fields.filter(f => keep[f])
  const bad = chosen.some(f => {
    const v = valueOf(f)
    return typeof v === 'number' && !(v >= 0)
  })
  return (
    <>
      <ul className="divide-y rounded-md border">
        {fields.map(f => (
          <li key={f} className={cn('flex flex-wrap items-center gap-2 px-2 py-2', !keep[f] && 'opacity-50')}>
            {open && <Checkbox checked={keep[f]} onCheckedChange={v => setKeep(k => ({ ...k, [f]: v === true }))} aria-label={PRODUCT_FIELDS[f]} />}
            <span className="w-36 shrink-0 text-xs text-slate-600">{PRODUCT_FIELDS[f]}</span>
            <span className="text-slate-500 line-through">{fieldValueText(f, diff[f]![0], names)}</span>
            <span aria-hidden>→</span>
            {open && editable(f)
              ? <Input value={values[f]} onChange={e => setValues(v => ({ ...v, [f]: e.target.value }))} className="h-8 w-40" inputMode={['price', 'cost_price', 'min_quantity'].includes(f) ? 'decimal' : undefined} />
              : <span className="font-medium">{fieldValueText(f, diff[f]![1], names)}</span>}
          </li>
        ))}
      </ul>
      {open && (
        <ConfirmButton kind={card.kind} busy={busy} disabled={!chosen.length || bad} onClick={() => onConfirm({
          after: Object.fromEntries(chosen.map(f => [f, valueOf(f)])),
        })} />
      )}
    </>
  )
}

function FileCard({ card }: { card: ActionCard }) {
  const tables = (card.payload.sections || []).filter((s: any) => s.table)
  const rows = tables.reduce((n: number, s: any) => n + s.table.rows.length, 0)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <FileText className="h-5 w-5 shrink-0 text-violet-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{card.title}</p>
        <Meta>{tables.length ? `${tables.length} ${tables.length === 1 ? 'таблица' : 'таблици'}, ${rows} реда` : 'Текст'}</Meta>
      </div>
      {card.kind === 'excel' && (
        <a href={`/api/assistant/files/${card.id}`} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          <Download className="mr-1.5 h-4 w-4" />Изтегли Excel
        </a>
      )}
      <a href={`/print/assistant/${card.id}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-md border px-3 text-sm">
        <Printer className="mr-1.5 h-4 w-4" />{card.kind === 'excel' ? 'Виж / печат' : 'Отвори за печат / PDF'}
      </a>
    </div>
  )
}
