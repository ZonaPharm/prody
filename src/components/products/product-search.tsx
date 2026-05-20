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

const SCROLL_KEY = 'catalog-scroll'
const FILTER_KEY = 'catalog-filters'

interface Props {
  categories: { id: string; name: string }[]
  stores: { id: string; name: string }[]
}

export default function ProductSearch({ categories, stores }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // On mount: check real browser URL (not searchParams which may be stale from RSC cache)
  const initRef = useRef(false)
  if (!initRef.current) {
    initRef.current = true
    if (typeof window !== 'undefined' && !window.location.search) {
      // Fresh visit — clear saved filters
      try { sessionStorage.removeItem(FILTER_KEY) } catch {}
    }
  }

  // Read sessionStorage AFTER potential clearing
  const saved = (() => {
    try { return JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') } catch { return {} }
  })()

  const [search, setSearch] = useState(searchParams.get('search') || saved.search || '')
  const [status, setStatus] = useState(searchParams.get('status') || saved.status || 'all')
  const [hasImages, setHasImages] = useState(searchParams.get('hasImages') || saved.hasImages || 'all')
  const [categoryId, setCategoryId] = useState(searchParams.get('category') || saved.category || 'all')
  const [storeId, setStoreId] = useState(searchParams.get('store') || saved.store || 'all')

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
      try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ search: s, status: st, hasImages: hi, category: cat, store })) } catch {}
      router.push(`/catalog?${params.toString()}`, { scroll: false })
    },
    [router, search, status, hasImages, categoryId, storeId]
  )

  useEffect(() => {
    const timer = setTimeout(() => updateParams({ search }), 300)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll restoration
  const scrollPending = useRef<string | null>(null)
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved && parseInt(saved) > 0) {
      scrollPending.current = saved
    }
    const handler = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  useEffect(() => {
    if (!scrollPending.current) return
    const savedY = parseInt(scrollPending.current)
    let attempts = 0
    const tryRestore = () => {
      attempts++
      if (document.body.scrollHeight > savedY) {
        window.scrollTo(0, savedY)
        scrollPending.current = null
      } else if (attempts < 30) {
        setTimeout(tryRestore, 100)
      } else {
        scrollPending.current = null
      }
    }
    const timer = setTimeout(tryRestore, 50)
    return () => {
      clearTimeout(timer)
    }
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
