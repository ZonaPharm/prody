'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowLeft, ArrowRight, Check, Copy, Loader2, Mail, PackageCheck, Printer, X } from 'lucide-react'
import { ProductThumb } from '@/components/deliveries/product-picker'
import { OrderStatusBadge } from './order-status-badge'
import { formatOrderNumber, orderTotals } from '@/lib/supplier-orders/format'
import { formatDeliveryNumber } from '@/lib/deliveries/format'
import { sofiaDateTime } from '@/lib/date-utils'
import type { OrderDetail } from '@/lib/supplier-orders/queries'
import { cn } from '@/lib/utils'
import { Meta, Note, PageHeader } from '@/components/ui/text'

/**
 * A sent, arrived or cancelled order. Steps on top (Поръчана → Изпратена →
 * Пристигна → Доставка) and one big button for what comes next: when the goods
 * come, "Пристигна" makes the delivery and opens it to check against the invoice.
 */
export function OrderView({ order, text, mailReady, justSent }: {
  order: OrderDetail
  /** The order as the supplier sees it, for "Копирай текста". */
  text: string
  mailReady: boolean
  justSent: 'email' | 'manual' | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'' | 'arrived' | 'resend' | 'cancel'>('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const t = orderTotals(order.lines)
  const deliveryGone = order.status === 'received' && (!order.delivery_id || order.delivery_status === 'cancelled')

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Грешка')
    return data
  }

  async function arrived() {
    setBusy('arrived')
    setError('')
    try {
      const data = await post(`/api/supplier-orders/${order.id}/arrived`)
      router.push(`/deliveries/${data.delivery_id}`)
    } catch (e: any) {
      setError(e.message)
      setBusy('')
    }
  }

  async function resend() {
    if (!confirm(`Да изпратя ли ${formatOrderNumber(order.number)} отново до ${order.supplier.order_emails.join(', ')}?`)) return
    setBusy('resend')
    setError('')
    try {
      await post(`/api/supplier-orders/${order.id}/send`, { via: 'email' })
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function cancel() {
    setBusy('cancel')
    setError('')
    try {
      await post(`/api/supplier-orders/${order.id}/cancel`, { reason })
      setCancelOpen(false)
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Копирането не мина')
    }
  }

  const sentText = order.sent_via === 'manual'
    ? `поръчана сами${order.sender ? ` (${order.sender})` : ''}`
    : `по имейл до ${order.sent_to.join(', ')}${order.send_count > 1 ? `, ${order.send_count} пъти` : ''}`

  const steps = [
    { label: 'Поръчка', detail: `${t.lines} ${t.lines === 1 ? 'продукт' : 'продукта'}, ${t.units} бр.`, done: true },
    { label: 'Изпратена', detail: order.sent_at ? sofiaDateTime(order.sent_at) : '—', done: !!order.sent_at },
    { label: 'Пристигна', detail: order.received_at ? sofiaDateTime(order.received_at) : 'чака стоката', done: order.status === 'received' },
    {
      label: 'Доставка',
      detail: order.delivery_number != null ? formatDeliveryNumber(order.delivery_number) : order.delivery_id ? 'чернова: сверете' : '—',
      done: order.delivery_status != null && order.delivery_status !== 'draft' && order.delivery_status !== 'cancelled',
    },
  ]
  const current = order.status === 'cancelled' ? -1 : steps.findIndex(s => !s.done)

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        back={<Button asChild variant="ghost" size="icon"><Link href="/deliveries/orders" aria-label="Назад към поръчките"><ArrowLeft className="h-4 w-4" /></Link></Button>}
        title={<span className="inline-flex flex-wrap items-center gap-3">Поръчка {formatOrderNumber(order.number)}<OrderStatusBadge status={order.status} className="tracking-normal" /></span>}
        intro={<>
          {order.supplier.name}{order.supplier.phone ? <> · <a className="underline" href={`tel:${order.supplier.phone}`}>{order.supplier.phone}</a></> : ''}
          {order.creator ? ` · създадена от ${order.creator}` : ''}
        </>}
      />

      {justSent && order.status === 'sent' && (
        <Note tone="success">
          {justSent === 'email' ? `Поръчката тръгна по имейл до ${order.sent_to.join(', ')}. Копие има и във вашата поща.` : 'Отбелязана е като поръчана. Сега чака стоката.'}
        </Note>
      )}

      {order.status !== 'cancelled' && (
        <ol className="grid grid-cols-4 gap-1 rounded-xl border bg-white p-2" aria-label="Стъпки">
          {steps.map((s, i) => {
            const state = s.done ? 'done' : i === current ? 'current' : 'todo'
            return (
              <li key={s.label} className="p-2" aria-current={state === 'current' ? 'step' : undefined}>
                <span className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'done' && 'bg-emerald-600 text-white',
                  state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
                  state === 'todo' && 'bg-slate-100 text-slate-500',
                )}>{state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                <span className="mt-1.5 block text-xs font-semibold sm:text-sm">{s.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">{s.detail}</span>
              </li>
            )
          })}
        </ol>
      )}

      {error && <Note tone="danger">{error}</Note>}

      {/* The one next step */}
      {(order.status === 'sent' || deliveryGone) && (
        <button
          type="button"
          onClick={arrived}
          disabled={!!busy}
          className="flex w-full items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-left text-primary-foreground shadow-sm hover:opacity-95 disabled:opacity-70"
        >
          <span>
            <span className="block text-xs uppercase tracking-wide opacity-75">Следваща стъпка, когато стоката дойде</span>
            <span className="block text-base font-semibold">Пристигна: направи доставка от поръчката</span>
            <span className="block text-xs opacity-80">Ще се отвори доставка с тези продукти. Сверете я с фактурата: бройки, цени, махнете недошлото, добавете дошлото извън поръчката.</span>
          </span>
          {busy === 'arrived' ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <PackageCheck className="h-6 w-6 shrink-0" />}
        </button>
      )}
      {order.status === 'received' && !deliveryGone && order.delivery_id && (
        <Link
          href={`/deliveries/${order.delivery_id}`}
          className="flex items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-sm hover:opacity-95"
        >
          <span>
            <span className="block text-xs uppercase tracking-wide opacity-75">{order.delivery_status === 'draft' ? 'Следваща стъпка' : 'Стоката'}</span>
            <span className="block text-base font-semibold">
              {order.delivery_status === 'draft' ? 'Сверете доставката с фактурата и я запазете' : `Доставка ${formatDeliveryNumber(order.delivery_number)}`}
            </span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0" />
        </Link>
      )}
      {order.status === 'cancelled' && (
        <Note tone="danger">
          Отказана{order.cancelled_at ? ` на ${sofiaDateTime(order.cancelled_at)}` : ''}{order.cancel_reason ? `: ${order.cancel_reason}` : ''}.
        </Note>
      )}

      <section className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="text-sm">
            <span className="font-semibold">{t.lines} {t.lines === 1 ? 'продукт' : 'продукта'}, {t.units} бр.</span>
            {order.sent_at && <span className="text-muted-foreground"> · {sentText}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copyText}>
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}{copied ? 'Копирано' : 'Копирай текста'}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/print/supplier-order/${order.id}`} target="_blank" rel="noreferrer"><Printer className="mr-1.5 h-4 w-4" />Печат</a>
            </Button>
            {order.status === 'sent' && order.supplier.order_emails.length > 0 && mailReady && (
              <Button size="sm" variant="outline" onClick={resend} disabled={!!busy}>
                {busy === 'resend' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mail className="mr-1.5 h-4 w-4" />}Изпрати пак
              </Button>
            )}
          </div>
        </div>
        <ul className="divide-y">
          {order.lines.map((l, i) => (
            <li key={l.product.id} className="flex items-center gap-3 p-3">
              <span className="w-5 text-xs text-slate-400 tabular-nums">{i + 1}</span>
              <ProductThumb src={l.product.image} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{l.product.name}</div>
                <Meta as="div">наличност {l.product.quantity_on_hand} бр.{l.note ? ` · ${l.note}` : ''}</Meta>
              </div>
              <span className="text-base font-semibold tabular-nums">{l.quantity} бр.</span>
            </li>
          ))}
        </ul>
        {order.notes && <p className="border-t p-3 text-sm"><span className="font-medium">Бележка:</span> {order.notes}</p>}
      </section>

      {order.status === 'sent' && (
        <div className="text-right">
          <Button variant="ghost" className="text-red-600" onClick={() => { setReason(''); setCancelOpen(true) }}>
            <X className="mr-1.5 h-4 w-4" />Откажи поръчката
          </Button>
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отказ на {formatOrderNumber(order.number)}</DialogTitle>
            <DialogDescription>
              Например доставчикът няма стоката или поръчката е по грешка. Доставчикът не се уведомява от приложението: кажете му сами.
            </DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Причина" maxLength={500} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Назад</Button>
            <Button variant="destructive" onClick={cancel} disabled={busy === 'cancel' || reason.trim().length < 3}>
              {busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Откажи поръчката
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
