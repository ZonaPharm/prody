'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Check, Loader2, Mail, Pencil, X } from 'lucide-react'
import { parseEmails } from '@/lib/supplier-orders/format'
import { Hint, Note, SectionTitle } from '@/components/ui/text'

type Supplier = {
  id: string
  name: string
  is_active: boolean
  notes: string | null
  order_emails?: string[] | null
  contact_name?: string | null
  phone?: string | null
}

type Edit = { name: string; emails: string; contact: string; phone: string }

/**
 * Suppliers of the deliveries. Never deleted (delivery lines point at them):
 * a supplier no longer used is switched off and drops out of the lists.
 * Each one can have e-mails for orders ("Поръчки"), a contact and a phone; the
 * signature at the end of every order is set once, at the bottom.
 */
export function SuppliersManager() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit>({ name: '', emails: '', contact: '', phone: '' })

  async function load() {
    setLoading(true)
    const res = await fetch('/api/suppliers')
    const data = await res.json()
    if (res.ok) setSuppliers(data)
    else setError(data.error || 'Списъкът не се зареди')
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function call(url: string, method: string, body: unknown) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Грешка')
      await load()
      return true
    } catch (e: any) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  function startEdit(s: Supplier) {
    setEditing(s.id)
    setError('')
    setEdit({ name: s.name, emails: (s.order_emails ?? []).join(', '), contact: s.contact_name ?? '', phone: s.phone ?? '' })
  }

  async function saveEdit(id: string) {
    const { emails, bad } = parseEmails(edit.emails)
    if (bad.length) { setError(`Това не е имейл: ${bad.join(', ')}`); return }
    if (emails.length > 5) { setError('Най-много 5 имейла'); return }
    const ok = await call(`/api/suppliers/${id}`, 'PATCH', {
      name: edit.name,
      order_emails: emails,
      contact_name: edit.contact.trim() || null,
      phone: edit.phone.trim() || null,
    })
    if (ok) setEditing(null)
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <form
        className="flex gap-2"
        onSubmit={async e => {
          e.preventDefault()
          if (!name.trim()) return
          if (await call('/api/suppliers', 'POST', { name: name.trim() })) setName('')
        }}
      >
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Нов доставчик" aria-label="Нов доставчик" />
        <Button type="submit" disabled={busy || !name.trim()}>Добави</Button>
      </form>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <ul className="rounded-lg border bg-white divide-y">
          {suppliers.map(s => (
            <li key={s.id} className="px-3 py-2 text-sm">
              {editing === s.id ? (
                <div className="space-y-2 py-1">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Име</span>
                      <Input value={edit.name} onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} className="h-9" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Имейл за поръчки <span className="font-normal text-muted-foreground">(до 5, със запетая)</span></span>
                      <Input value={edit.emails} onChange={e => setEdit(v => ({ ...v, emails: e.target.value }))} className="h-9" placeholder="orders@доставчик.bg" inputMode="email" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Лице за контакт <span className="font-normal text-muted-foreground">(за поздрава)</span></span>
                      <Input value={edit.contact} onChange={e => setEdit(v => ({ ...v, contact: e.target.value }))} className="h-9" placeholder="г-жо Иванова" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Телефон</span>
                      <Input value={edit.phone} onChange={e => setEdit(v => ({ ...v, phone: e.target.value }))} className="h-9" inputMode="tel" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => saveEdit(s.id)}><Check className="mr-1.5 h-4 w-4" />Запази</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setError('') }}><X className="mr-1.5 h-4 w-4" />Отказ</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <span className={s.is_active ? '' : 'text-slate-400 line-through'}>{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {(s.order_emails ?? []).length > 0
                        ? <><Mail className="mr-1 inline h-3 w-3" />{(s.order_emails ?? []).join(', ')}</>
                        : 'без имейл за поръчки'}
                      {s.contact_name ? ` · ${s.contact_name}` : ''}{s.phone ? ` · ${s.phone}` : ''}
                    </span>
                  </div>
                  <Button size="icon" variant="ghost" aria-label={`Промени ${s.name}`} onClick={() => startEdit(s)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => call(`/api/suppliers/${s.id}`, 'PATCH', { is_active: !s.is_active })}>
                    {s.is_active ? 'Изключи' : 'Включи'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Доставчиците не се трият, защото редовете от доставките сочат към тях. Изключеният не се предлага в нови доставки и поръчки.
        На доставчик с имейл поръчката се изпраща направо от „Поръчки“.
      </p>
      <OrderSignature />
    </div>
  )
}

/** The text at the end of every order to a supplier: company, delivery address, phone. */
function OrderSignature() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [mailReady, setMailReady] = useState(true)
  const [state, setState] = useState<'loading' | 'idle' | 'saving' | 'done' | 'missing'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/supplier-orders/settings')
      .then(async r => {
        if (!r.ok) { setState('missing'); return }
        const d = await r.json()
        setValue(d.order_signature ?? '')
        setSaved(d.order_signature ?? '')
        setMailReady(!!d.mail_ready)
        setState('idle')
      })
      .catch(() => setState('missing'))
  }, [])

  if (state === 'missing' || state === 'loading') return null

  async function save() {
    setState('saving')
    setError('')
    const res = await fetch('/api/supplier-orders/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_signature: value.trim() || null }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error || 'Не се запази'); setState('idle'); return }
    setSaved(value.trim())
    setState('done')
  }

  return (
    <section className="space-y-2 rounded-lg border bg-white p-3">
      <SectionTitle>Подпис на поръчките</SectionTitle>
      <Hint small>
        Стои в края на всяка поръчка към доставчик. Първият ред е името на фирмата (то е и в темата на имейла). Добавете адрес за доставка и телефон.
      </Hint>
      <Textarea rows={4} maxLength={1000} value={value} onChange={e => { setValue(e.target.value); if (state === 'done') setState('idle') }}
        placeholder={'Зона Фарма ЕООД\nАдрес за доставка: …\nТел.: …'} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!mailReady && (
        <Note tone="warn" small>Пощата на приложението не е настроена (раздел „Имейл“), затова поръчките още не могат да тръгват по имейл.</Note>
      )}
      <Button size="sm" onClick={save} disabled={state === 'saving' || value.trim() === saved}>
        {state === 'saving' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
        {state === 'done' ? 'Запазено' : 'Запази подписа'}
      </Button>
    </section>
  )
}
