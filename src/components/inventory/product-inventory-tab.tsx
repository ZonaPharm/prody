'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StockPerStore } from './stock-per-store'
import { MovementHistory } from './movement-history'
import { RestockForm } from './restock-form'
import { TransferForm } from './transfer-form'
import { Loader2 } from 'lucide-react'

interface ProductInventoryTabProps {
  productId: string
  productName: string
  stores: { id: string; name: string; is_warehouse: boolean }[]
  autoRestock?: boolean
  initialQty?: number
  initialCost?: number
  /** Third tab "Доставки" (only where the Deliveries menu is on), drawn by the server page. */
  deliveries?: { count: number; node: React.ReactNode }
  initialTab?: 'stock' | 'movements' | 'deliveries'
}

export function ProductInventoryTab({ productId, productName, stores, autoRestock, initialQty, initialCost, deliveries, initialTab = 'stock' }: ProductInventoryTabProps) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => setRefreshKey(k => k + 1)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/inventory/product/${productId}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [productId, refreshKey])

  if (loading) {
    return (
      <Card id="product-stock">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  // Aggregate by store_id (not name) for reliable store matching
  const stockMap: Record<string, { store_name: string; qty: number; value: number; batches: number }> = {}
  ;(data?.batches || []).forEach((b: any) => {
    const sid = b.store_id
    const name = b.store?.name || '—'
    if (!stockMap[sid]) stockMap[sid] = { store_name: name, qty: 0, value: 0, batches: 0 }
    stockMap[sid].qty += b.quantity_remaining
    stockMap[sid].value += b.quantity_remaining * Number(b.unit_cost)
    stockMap[sid].batches++
  })

  const stockPerStore = Object.entries(stockMap).map(([store_id, s]) => ({
    store_id,
    store_name: s.store_name,
    total_qty: s.qty,
    total_value: Math.round(s.value * 100) / 100,
    batches: s.batches,
  }))

  const movements = (data?.movements || []).map((m: any) => ({
    id: m.id,
    type: m.type,
    quantity: m.quantity,
    unit_cost: m.unit_cost,
    unit_price: m.unit_price,
    store_name: m.store?.name || '—',
    notes: m.notes,
    created_at: m.created_at,
  }))

  return (
    <Card id="product-stock" className="scroll-mt-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <CardTitle className="text-lg">{deliveries ? 'Наличност, движения и доставки' : 'Складова наличност и движения'}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <TransferForm
            productId={productId}
            productName={productName}
            stores={stores}
            currentStock={stockPerStore.map((s: any) => ({
              store_id: s.store_id,
              store_name: s.store_name,
              qty: s.total_qty,
            }))}
            onSuccess={refresh}
          />
          <RestockForm productId={productId} productName={productName} stores={stores} onSuccess={refresh} autoOpen={autoRestock} initialQty={initialQty} initialCost={initialCost} />
        </div>
      </CardHeader>
      <CardContent>
        <Tabs key={initialTab} defaultValue={deliveries || initialTab !== 'deliveries' ? initialTab : 'stock'}>
          <TabsList>
            <TabsTrigger value="stock">По магазини</TabsTrigger>
            <TabsTrigger value="movements">Движения</TabsTrigger>
            {deliveries && <TabsTrigger value="deliveries">Доставки ({deliveries.count})</TabsTrigger>}
          </TabsList>
          <TabsContent value="stock" className="pt-4">
            <StockPerStore data={stockPerStore} />
          </TabsContent>
          <TabsContent value="movements" className="pt-4">
            <MovementHistory data={movements} />
          </TabsContent>
          {deliveries && (
            <TabsContent value="deliveries" className="pt-4">
              {deliveries.node}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  )
}
