'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SupplierOption = { id: string; name: string; is_active: boolean }

const NEW = '__new__'

/**
 * A plain select of the active suppliers, with "+ Нов доставчик…" at the end.
 * A switched-off supplier still shows when a line already points at it.
 */
export function SupplierSelect({
  value,
  suppliers,
  onChange,
  onCreated,
  className,
  placeholder = '— доставчик —',
  ariaLabel = 'Доставчик',
  disabled,
}: {
  value: string | null
  suppliers: SupplierOption[]
  onChange: (id: string | null) => void
  onCreated: (s: SupplierOption) => void
  className?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const visible = suppliers.filter(s => s.is_active || s.id === value)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Въведете име')
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Доставчикът не можа да се добави')
      onCreated(data)
      onChange(data.id)
      setName('')
      setAdding(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        className={cn('h-9 rounded-md border border-input bg-white px-2 text-sm min-w-0', className)}
        value={value ?? ''}
        onChange={e => {
          if (e.target.value === NEW) setAdding(true)
          else onChange(e.target.value || null)
        }}
      >
        <option value="">{placeholder}</option>
        {visible.map(s => (
          <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (изключен)'}</option>
        ))}
        <option value={NEW}>+ Нов доставчик…</option>
      </select>
      <Dialog open={adding} onOpenChange={o => { setAdding(o); if (!o) { setName(''); setError('') } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Нов доставчик</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Име" autoFocus aria-label="Име на доставчика" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Отказ</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Добави</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
