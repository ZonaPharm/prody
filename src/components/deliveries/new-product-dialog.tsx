'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, PackagePlus } from 'lucide-react'
import type { DeliveryProduct } from '@/lib/deliveries/products'
import type { LabelKind } from '@/lib/label-kind'
import { LabelKindSelect } from './label-kind-select'
import { Note } from '@/components/ui/text'

type Option = { id: string; name: string }

/**
 * "Нов продукт" without leaving the delivery: name, sale price, category and
 * whether it needs a label. Active at once; its stock comes with the delivery.
 */
export function NewProductDialog({
  categories,
  supplierId,
  onCreated,
  disabled,
}: {
  categories: Option[]
  supplierId: string | null
  onCreated: (p: DeliveryProduct) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [labelKind, setLabelKind] = useState<LabelKind>('full')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setName(''); setPrice(''); setCategory(''); setLabelKind('full'); setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const p = Number(price.replace(',', '.'))
    if (name.trim().length < 2) return setError('Въведете име')
    if (!(p > 0)) return setError('Въведете продажна цена над 0')
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/deliveries/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          price: p,
          category_id: category || null,
          supplier_id: supplierId,
          needs_label: labelKind === 'full',
          label_kind: labelKind,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Продуктът не можа да се създаде')
      onCreated(data)
      reset()
      setOpen(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <PackagePlus className="mr-2 h-4 w-4" />Нов продукт
      </Button>
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Нов продукт</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="np-name">Име</Label>
              <Input id="np-name" value={name} onChange={e => setName(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="np-price">Продажна цена (€)</Label>
                <Input id="np-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="8,90" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="np-cat">Категория</Label>
                <select id="np-cat" className="h-10 w-full rounded-md border border-input bg-white px-2 text-sm" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">—</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Етикет</Label>
              <LabelKindSelect id="np-label" value={labelKind} onChange={setLabelKind} />
            </div>
            <Note small>
              Продуктът става активен веднага, без наличност. Снимки, описание и останалото се попълват после в „Каталог“.
            </Note>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отказ</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Създай и добави
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
