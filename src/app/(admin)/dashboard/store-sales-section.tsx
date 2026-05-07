'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StoreSalesChart } from './charts'

interface StoreSalesSectionProps {
  stores: { id: string; name: string }[]
}

export function StoreSalesSection({ stores }: StoreSalesSectionProps) {
  const [days, setDays] = useState('7')
  const [data, setData] = useState<any[]>([])

  useEffect(() => {
    fetch(`/api/reports/store-sales?days=${days}`)
      .then(r => r.json())
      .then(setData)
  }, [days])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Оборот по магазини</CardTitle>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 дни</SelectItem>
            <SelectItem value="14">14 дни</SelectItem>
            <SelectItem value="30">30 дни</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <StoreSalesChart data={data} stores={stores.map(s => s.name)} />
      </CardContent>
    </Card>
  )
}
