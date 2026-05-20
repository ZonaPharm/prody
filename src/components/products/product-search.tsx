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

  // On mount: real browser URL is authoritative over stale RSC-cached searchParams
  // sessionStorage is tab-scoped — naturally empty on genuine fresh visits (new tab)
  // so no explicit clearing is needed
  const initRef = useRef(false)
  const urlInitial = useRef<Record<string, string>>({})
  const savedRef = useRef<Record<string, string>>({})

  if (!initRef.current) {
    initRef.current = true
    if (typeof window !== 'undefined') {
      // Read saved filters from previous tab session
      try { savedRef.current = JSON.parse(sessionStorage.getItem(FILTER_KEY) || '{}') } catch {}
      // Back/forward navigation — real URL params are authoritative
      if (window.location.search) {
        const p = new URLSearchParams(window.location.search)
        urlInitial.current = {
          search: p.get('search') || '',
          status: p.get('status') || '',
          hasImages: p.get('hasImages') || '',
          category: p.get('category') || '',
          store: p.get('store') || '',
        }
      }
    }
  }

  // Priority: real browser URL → searchParams (SSR) → sessionStorage → defaults
  const [search, setSearch] = useState(
    urlInitial.current.search || searchParams.get('search') || savedRef.current.search || ''
  )
  const [status, setStatus] = useState(
    urlInitial.current.status || searchParams.get('status') || savedRef.current.status || 'all'
  )
  const [hasImages, setHasImages] = useState(
    urlInitial.current.hasImages || searchParams.get('hasImages') || savedRef.current.hasImages || 'all'
  )
  const [categoryId, setCategoryId] = useState(
    urlInitial.current.category || searchParams.get('category') || savedRef.current.category || 'all'
  )
  const [storeId, setStoreId] = useState(
    urlInitial.current.store || searchParams.get('store') || savedRef.current.store || 'all'
  )

  const updateParams = useCallback(
    (opts: { search?: string; status?: string; hasImages?: string; category?: string; store?: string; replace?: boolean }) => {
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
      const url = `/catalog?${params.toString()}`
      if (opts.replace) {
        router.replace(url, { scroll: false })
      } else {
        router.push(url, { scroll: false })
      }
    },
    [router, search, status, hasImages, categoryId, storeId]
  )

  // Debounce search: skip if URL already matches (avoids flash on mount)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const urlSearch = new URLSearchParams(window.location.search).get('search') || ''
        if (search === urlSearch) return
      } catch {}
      updateParams({ search, replace: true })
    }, 300)
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
