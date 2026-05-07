'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Warehouse } from 'lucide-react'

interface StockEntry {
  store_name: string
  total_qty: number
  total_value: number
  batches: number
}

export function StockPerStore({ data }: { data: StockEntry[] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Няма наличности</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {data.map((s, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-muted-foreground" />
              {s.store_name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{s.total_qty} бр.</div>
            <p className="text-xs text-muted-foreground">
              {s.total_value.toFixed(2)} € · {s.batches} партиди
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
