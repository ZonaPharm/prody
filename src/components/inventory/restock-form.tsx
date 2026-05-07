'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Package, Loader2 } from 'lucide-react'

interface StoreInfo {
  id: string
  name: string
  is_warehouse: boolean
}

interface RestockFormProps {
  productId: string
  productName: string
  stores: StoreInfo[]
  currentStock?: { store_id: string; qty: number }[]
  autoOpen?: boolean
  onSuccess?: () => void
  initialQty?: number
  initialCost?: number
}

export function RestockForm({ productId, productName, stores, autoOpen, onSuccess, initialQty, initialCost }: RestockFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(autoOpen || false)
  const [totalQty, setTotalQty] = useState(initialQty ? String(initialQty) : '')
  const [unitCost, setUnitCost] = useState(initialCost ? String(initialCost) : '')
  const [distribution, setDistribution] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const warehouse = stores.find(s => s.is_warehouse)
  const regularStores = stores.filter(s => !s.is_warehouse)

  const total = parseInt(totalQty) || 0
  const allocated = Object.values(distribution).reduce((s, v) => s + (parseInt(v) || 0), 0)
  const unallocated = total - allocated

  const handleSubmit = async () => {
    if (!total || !unitCost) { setError('Попълнете количество и цена'); return }
    if (unallocated < 0) { setError('Разпределеното надвишава общото'); return }

    setLoading(true)
    setError('')
    try {
      const dist = Object.entries(distribution)
        .filter(([, qty]) => parseInt(qty) > 0)
        .map(([storeId, qty]) => ({ storeId, qty: parseInt(qty) }))

      const res = await fetch('/api/inventory/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          quantity: total,
          unit_cost: parseFloat(unitCost),
          distribution: dist,
          notes: 'Заредено от администратор',
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error)
      }

      setOpen(false)
      if (onSuccess) onSuccess()
      else router.refresh()
    } catch (err: any) {
      setError(err.message || 'Грешка при зареждане')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Package className="mr-2 h-4 w-4" /> Зареди
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Зареждане: {productName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Общо количество</Label>
              <Input type="number" min="1" value={totalQty} onChange={e => setTotalQty(e.target.value)} placeholder="100" />
            </div>
            <div className="space-y-2">
              <Label>Доставна цена (€)</Label>
              <Input type="number" step="0.01" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="5.00" />
            </div>
          </div>

          {total > 0 && (
            <div className="space-y-2">
              <Label>Разпределение по магазини</Label>
              {warehouse && (
                <p className="text-xs text-muted-foreground">
                  Неразпределени: {unallocated} бр. → {warehouse.name} (склад)
                </p>
              )}
              <div className="space-y-2 max-h-[200px] overflow-auto">
                {regularStores.map(store => (
                  <div key={store.id} className="flex items-center gap-3">
                    <Label className="w-32 text-sm truncate">{store.name}</Label>
                    <Input
                      type="number"
                      min="0"
                      max={total}
                      className="w-24 h-8 text-sm"
                      value={distribution[store.id] || ''}
                      onChange={e => setDistribution(prev => ({ ...prev, [store.id]: e.target.value }))}
                      placeholder="0"
                    />
                    <span className="text-xs text-muted-foreground">бр.</span>
                  </div>
                ))}
              </div>
              {warehouse && (
                <div className="flex items-center gap-3 bg-slate-50 rounded p-2">
                  <Label className="w-32 text-sm font-medium">{warehouse.name} (склад)</Label>
                  <span className="text-sm font-bold">{unallocated} бр.</span>
                  <span className="text-xs text-muted-foreground">авт.</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Отказ</Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Зареди
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
