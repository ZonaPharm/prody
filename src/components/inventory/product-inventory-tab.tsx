'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StockPerStore } from './stock-per-store'
import { MovementHistory } from './movement-history'
import { RestockForm } from './restock-form'
import { Loader2 } from 'lucide-react'

interface ProductInventoryTabProps {
  productId: string
  productName: string
  stores: { id: string; name: string; is_warehouse: boolean }[]
}

export function ProductInventoryTab({ productId, productName, stores }: ProductInventoryTabProps) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/inventory/product/${productId}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [productId])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const stockMap: Record<string, { qty: number; value: number; batches: number }> = {}
  ;(data?.batches || []).forEach((b: any) => {
    const name = b.store?.name || '—'
    if (!stockMap[name]) stockMap[name] = { qty: 0, value: 0, batches: 0 }
    stockMap[name].qty += b.quantity_remaining
    stockMap[name].value += b.quantity_remaining * Number(b.unit_cost)
    stockMap[name].batches++
  })

  const stockPerStore = Object.entries(stockMap).map(([store_name, s]) => ({
    store_name,
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Складова наличност и движения</CardTitle>
        <RestockForm productId={productId} productName={productName} stores={stores} currentStock={[]} />
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="stock">
          <TabsList>
            <TabsTrigger value="stock">По магазини</TabsTrigger>
            <TabsTrigger value="movements">Движения</TabsTrigger>
          </TabsList>
          <TabsContent value="stock" className="pt-4">
            <StockPerStore data={stockPerStore} />
          </TabsContent>
          <TabsContent value="movements" className="pt-4">
            <MovementHistory data={movements} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
