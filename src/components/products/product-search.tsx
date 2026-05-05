'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Всички' },
  { value: 'ordered', label: 'Поръчан' },
  { value: 'received', label: 'Получен' },
  { value: 'listed', label: 'В каталог' },
  { value: 'damaged', label: 'Повреден' },
  { value: 'returned', label: 'Върнат' },
]

export default function ProductSearch() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [status, setStatus] = useState(searchParams.get('status') || 'all')

  const updateParams = useCallback(
    (newSearch: string, newStatus: string) => {
      const params = new URLSearchParams()
      if (newSearch) params.set('search', newSearch)
      if (newStatus && newStatus !== 'all') params.set('status', newStatus)
      router.push(`/catalog?${params.toString()}`)
    },
    [router]
  )

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      updateParams(search, status)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, updateParams, status])

  function handleStatusChange(value: string) {
    setStatus(value)
    updateParams(search, value)
  }

  return (
    <div className="flex gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Търсене на продукти..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={status} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Статус" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
