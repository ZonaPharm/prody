'use client'

import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface MySalesFiltersProps {
  from: string
  to: string
}

export function MySalesFilters({ from, to }: MySalesFiltersProps) {
  const router = useRouter()

  const navigate = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search)
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page')
    router.push(`/my-sales?${params.toString()}`)
    router.refresh()
  }

  const setToday = () => {
    const today = new Date().toISOString().split('T')[0]
    router.push(`/my-sales?from=${today}&to=${today}`)
    router.refresh()
  }

  const setThisWeek = () => {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    router.push(`/my-sales?from=${monday.toISOString().split('T')[0]}&to=${sunday.toISOString().split('T')[0]}`)
    router.refresh()
  }

  const setThisMonth = () => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    router.push(`/my-sales?from=${first.toISOString().split('T')[0]}&to=${last.toISOString().split('T')[0]}`)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="text-xs text-muted-foreground">От</label>
        <Input type="date" defaultValue={from} onChange={e => navigate('from', e.target.value)} className="w-[140px] h-9 text-sm" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">До</label>
        <Input type="date" defaultValue={to} onChange={e => navigate('to', e.target.value)} className="w-[140px] h-9 text-sm" />
      </div>
      <div className="flex gap-1 ml-1">
        <Button type="button" variant="ghost" size="sm" className="h-9 text-xs" onClick={setToday}>Днес</Button>
        <Button type="button" variant="ghost" size="sm" className="h-9 text-xs" onClick={setThisWeek}>Седмица</Button>
        <Button type="button" variant="ghost" size="sm" className="h-9 text-xs" onClick={setThisMonth}>Месец</Button>
      </div>
    </div>
  )
}
