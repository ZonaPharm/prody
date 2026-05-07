'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowRightLeft, Loader2 } from 'lucide-react'

interface StoreInfo {
  id: string
  name: string
  is_warehouse: boolean
}

interface TransferFormProps {
  productId: string
  productName: string
  stores: StoreInfo[]
  currentStock: { store_id: string; store_name: string; qty: number }[]
}

export function TransferForm({ productId, productName, stores, currentStock }: TransferFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fromStoreId, setFromStoreId] = useState('')
  const [toStoreId, setToStoreId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fromStore = stores.find(s => s.id === fromStoreId)
  const maxQty = currentStock.find(s => s.store_id === fromStoreId)?.qty || 0

  const handleTransfer = async () => {
    if (!fromStoreId || !toStoreId || !quantity) { setError('Попълнете всички полета'); return }
    if (fromStoreId === toStoreId) { setError('Изберете различни магазини'); return }
    if (parseInt(quantity) > maxQty) { setError(`Максимум: ${maxQty} бр.`); return }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          from_store_id: fromStoreId,
          to_store_id: toStoreId,
          quantity: parseInt(quantity),
        }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error) }
      setOpen(false)
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Грешка при трансфер')
    } finally {
      setLoading(false)
    }
  }

  const storesWithStock = stores.filter(s => currentStock.some(c => c.store_id === s.id && c.qty > 0))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowRightLeft className="mr-2 h-4 w-4" /> Прехвърли
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Прехвърляне: {productName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          <div className="space-y-2">
            <Label>От магазин</Label>
            <Select value={fromStoreId} onValueChange={setFromStoreId}>
              <SelectTrigger><SelectValue placeholder="Избери източник" /></SelectTrigger>
              <SelectContent>
                {storesWithStock.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({currentStock.find(c => c.store_id === s.id)?.qty || 0} бр.)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Към магазин</Label>
            <Select value={toStoreId} onValueChange={setToStoreId}>
              <SelectTrigger><SelectValue placeholder="Избери дестинация" /></SelectTrigger>
              <SelectContent>
                {stores.filter(s => s.id !== fromStoreId).map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Количество ({fromStore ? `макс. ${maxQty} бр.` : ''})</Label>
            <Input type="number" min="1" max={maxQty} value={quantity}
              onChange={e => setQuantity(e.target.value)} placeholder="0" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Отказ</Button>
            <Button onClick={handleTransfer} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Прехвърли
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
