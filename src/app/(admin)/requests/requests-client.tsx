'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Check, Loader2, ArrowRightLeft } from 'lucide-react'

interface Request {
  id: string
  product_name: string
  store_name: string
  quantity: number
  status: string
  notes: string | null
  created_at: string
}

export function RequestsClient({ requests: initialRequests }: { requests: Request[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [loading, setLoading] = useState<string | null>(null)
  const [fulfillReq, setFulfillReq] = useState<Request | null>(null)
  const [stockData, setStockData] = useState<any[]>([])
  const [transferQtys, setTransferQtys] = useState<Record<string, number>>({})
  const [fulfilling, setFulfilling] = useState(false)

  const openFulfill = async (req: Request) => {
    setFulfillReq(req)
    // Fetch product inventory
    const id = req.id // We need the product_id; let's store it differently
    setTransferQtys({})
    try {
      const res = await fetch(`/api/inventory/requests/${req.id}/stock`)
      const data = await res.json()
      setStockData(data || [])
    } catch {
      setStockData([])
    }
  }

  const executeFulfill = async () => {
    if (!fulfillReq) return
    setFulfilling(true)
    // Transfer from selected stores
    const transfers = Object.entries(transferQtys)
      .filter(([, qty]) => qty > 0)
      .map(([storeId, qty]) => ({ fromStoreId: storeId, qty }))

    try {
      for (const t of transfers) {
        await fetch('/api/inventory/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id: (fulfillReq as any).product_id,
            from_store_id: t.fromStoreId,
            to_store_id: (fulfillReq as any).store_id,
            quantity: t.qty,
          }),
        })
      }
      await fetch(`/api/inventory/requests/${fulfillReq.id}/fulfill`, { method: 'POST' })
      setRequests(prev => prev.map(r => r.id === fulfillReq.id ? { ...r, status: 'fulfilled' } : r))
      setFulfillReq(null)
      setFulfilling(false)
      router.refresh()
    } catch {
      setFulfilling(false)
    }
  }

  const fulfill = async (id: string) => {
    setLoading(id)
    await fetch(`/api/inventory/requests/${id}/fulfill`, { method: 'POST' })
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled' } : r))
    setLoading(null)
    router.refresh()
  }

  const pending = requests.filter(r => r.status === 'pending')
  const fulfilled = requests.filter(r => r.status === 'fulfilled')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {pending.length} чакащи · {fulfilled.length} изпълнени
        </p>
      </div>

      {pending.length === 0 && fulfilled.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">
          <p>Няма заявки</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                Чакащи
                <Badge variant="destructive" className="text-[10px]">{pending.length}</Badge>
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Магазин</th>
                      <th className="text-center px-4 py-3 font-medium">Кол.</th>
                      <th className="text-right px-4 py-3 font-medium">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(req => (
                      <tr key={req.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums font-semibold">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openFulfill(req)}
                            >
                              <ArrowRightLeft className="mr-1 h-3 w-3" />
                              Прехвърли
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-green-600"
                              onClick={() => fulfill(req.id)}
                              disabled={loading === req.id}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fulfilled.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-muted-foreground">
                Изпълнени ({fulfilled.length})
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden opacity-60">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Магазин</th>
                      <th className="text-center px-4 py-3 font-medium">Кол.</th>
                      <th className="text-right px-4 py-3 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fulfilled.map(req => (
                      <tr key={req.id} className="border-b last:border-0">
                        <td className="px-4 py-3">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px]">Изпълнена</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fulfill Dialog */}
      {fulfillReq && (
        <Dialog open={!!fulfillReq} onOpenChange={() => setFulfillReq(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>
                Прехвърляне към {fulfillReq.store_name}: {fulfillReq.product_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Заявено: <strong>{fulfillReq.quantity} бр.</strong>
              </p>
              {stockData.length === 0 ? (
                <p className="text-sm text-muted-foreground">Зареждане на данни...</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-auto">
                  {stockData.map((s: any) => (
                    <div key={s.store_id} className="flex items-center gap-3 p-2 rounded border">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{s.store_name}</p>
                        <p className="text-xs text-muted-foreground">{s.qty} бр. налични</p>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        max={s.qty}
                        className="w-20 h-8 text-sm"
                        placeholder="0"
                        value={transferQtys[s.store_id] || ''}
                        onChange={e => setTransferQtys(prev => ({
                          ...prev,
                          [s.store_id]: parseInt(e.target.value) || 0,
                        }))}
                      />
                      <span className="text-xs text-muted-foreground">бр.</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setFulfillReq(null)}>Отказ</Button>
                <Button onClick={executeFulfill} disabled={fulfilling}>
                  {fulfilling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Прехвърли избраните
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
