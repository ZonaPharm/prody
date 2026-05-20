'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
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

interface Props {
  categories: { id: string; name: string }[]
  stores: { id: string; name: string }[]
}

export default function ProductSearch({ categories, stores }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [status, setStatus] = useState(searchParams.get('status') || 'all')
  const [hasImages, setHasImages] = useState(searchParams.get('hasImages') || 'all')
  const [categoryId, setCategoryId] = useState(searchParams.get('category') || 'all')
  const [storeId, setStoreId] = useState(searchParams.get('store') || 'all')

  // Sync state from URL when navigating back/forward
  useEffect(() => {
    setSearch(searchParams.get('search') || '')
    setStatus(searchParams.get('status') || 'all')
    setHasImages(searchParams.get('hasImages') || 'all')
    setCategoryId(searchParams.get('category') || 'all')
    setStoreId(searchParams.get('store') || 'all')
  }, [searchParams])

  const updateParams = useCallback(
    (opts: { search?: string; status?: string; hasImages?: string; category?: string; store?: string }) => {
      const params = new URLSearchParams()
      const s = opts.search ?? search
      const st = opts.status ?? status
      const hi = opts.hasImages ?? hasImages
      const cat = opts.category ?? categoryId
      const store = opts.store ?? storeId
      if (s) params.set('search', s)
      if (st && st !== 'all') params.set('status', st)
      if (hi && hi !== 'all') params.set('hasImages', hi)
      if (cat && cat !== 'all') params.set('category', cat)
      if (store && store !== 'all') params.set('store', store)
      router.push(`/catalog?${params.toString()}`)
    },
    [router, search, status, hasImages, categoryId, storeId]
  )

  useEffect(() => {
    const timer = setTimeout(() => updateParams({ search }), 300)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll restoration — retry until content loads
  const scrollRestored = useRef(false)
  useEffect(() => {
    const key = 'catalog-scroll'
    const saved = sessionStorage.getItem(key)
    if (!saved) return
    scrollRestored.current = false
    let attempts = 0
    const tryRestore = () => {
      if (scrollRestored.current) return
      attempts++
      if (parseInt(saved) > 0) {
        window.scrollTo(0, parseInt(saved))
        if (window.scrollY > 0) scrollRestored.current = true
      }
      if (!scrollRestored.current && attempts < 10) {
        requestAnimationFrame(tryRestore)
      }
    }
    requestAnimationFrame(tryRestore)
    const handler = () => sessionStorage.setItem(key, String(window.scrollY))
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Търсене на продукти..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <Select value={status} onValueChange={(v) => { setStatus(v); updateParams({ status: v }) }}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Статус" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); updateParams({ category: v }) }}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Категория" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Всички категории</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={storeId} onValueChange={(v) => { setStoreId(v); updateParams({ store: v }) }}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Обект" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Всички обекти</SelectItem>
          {stores.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={hasImages} onValueChange={(v) => { setHasImages(v); updateParams({ hasImages: v }) }}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Снимки" />
        </SelectTrigger>
        <SelectContent>
          {IMAGE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
