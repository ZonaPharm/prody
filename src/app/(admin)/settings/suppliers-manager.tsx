'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Loader2, Pencil, X } from 'lucide-react'

type Supplier = { id: string; name: string; is_active: boolean; notes: string | null }

/**
 * Suppliers of the deliveries. Never deleted (delivery lines point at them):
 * a supplier no longer used is switched off and drops out of the lists.
 */
export function SuppliersManager() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

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

  return (
    <div className="space-y-4 max-w-2xl">
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <ul className="rounded-lg border bg-white divide-y">
          {suppliers.map(s => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing === s.id ? (
                <>
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" aria-label="Име" />
                  <Button size="icon" variant="ghost" aria-label="Запази" disabled={busy}
                    onClick={async () => { if (await call(`/api/suppliers/${s.id}`, 'PATCH', { name: editName })) setEditing(null) }}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Отказ" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <span className={s.is_active ? 'flex-1' : 'flex-1 text-slate-400 line-through'}>{s.name}</span>
                  <Button size="icon" variant="ghost" aria-label={`Преименувай ${s.name}`} onClick={() => { setEditing(s.id); setEditName(s.name) }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy}
                    onClick={() => call(`/api/suppliers/${s.id}`, 'PATCH', { is_active: !s.is_active })}>
                    {s.is_active ? 'Изключи' : 'Включи'}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Доставчиците не се трият, защото редовете от доставките сочат към тях. Изключеният не се предлага в нови доставки.
      </p>
    </div>
  )
}
