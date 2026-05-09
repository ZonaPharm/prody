'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Всички' },
  { value: 'active', label: 'Активни' },
  { value: 'inactive', label: 'Неактивни' },
]

const IMAGE_OPTIONS = [
  { value: 'all', label: 'Снимки' },
  { value: 'yes', label: 'Със снимки' },
  { value: 'no', label: 'Без снимки' },
]

export default function ProductSearch() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [status, setStatus] = useState(searchParams.get('status') || 'all')
  const [hasImages, setHasImages] = useState(searchParams.get('hasImages') || 'all')

  const updateParams = useCallback(
    (newSearch: string, newStatus: string, newHasImages: string) => {
      const params = new URLSearchParams()
      if (newSearch) params.set('search', newSearch)
      if (newStatus && newStatus !== 'all') params.set('status', newStatus)
      if (newHasImages && newHasImages !== 'all') params.set('hasImages', newHasImages)
      router.push(`/catalog?${params.toString()}`)
    },
    [router]
  )

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      updateParams(search, status, hasImages)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, updateParams, status, hasImages])

  function handleStatusChange(value: string) {
    setStatus(value)
    updateParams(search, value, hasImages)
  }

  function handleImagesChange(value: string) {
    setHasImages(value)
    updateParams(search, status, value)
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
        <SelectTrigger className="w-[160px]">
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
      <Select value={hasImages} onValueChange={handleImagesChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Снимки" />
        </SelectTrigger>
        <SelectContent>
          {IMAGE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
