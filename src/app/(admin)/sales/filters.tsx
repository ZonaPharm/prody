'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChevronDown, Search, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface SalesFiltersProps {
  fromDate: string
  toDate: string
  store?: string
  product?: string
  category?: string
  grouped?: string
  stores: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  products: { id: string; name: string }[]
}

export function SalesFilters({ fromDate, toDate, store, product, category, grouped, stores, categories, products }: SalesFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page') // reset to page 1
    router.replace(`/sales?${params.toString()}`)
  }

  const selectedStoreIds = store ? store.split(',').filter(Boolean) : []
  const storeNameMap = new Map(stores.map(s => [s.id, s.name]))
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open])

  const toggleStore = (storeId: string) => {
    const next = selectedStoreIds.includes(storeId)
      ? selectedStoreIds.filter(id => id !== storeId)
      : [...selectedStoreIds, storeId]
    update('store', next.join(','))
  }

  const selectAllStores = () => {
    update('store', stores.map(s => s.id).join(','))
  }
  const clearStoreFilter = () => {
    update('store', '')
    setOpen(false)
  }
  const storeLabel = selectedStoreIds.length === 0
    ? 'Всички обекти'
    : selectedStoreIds.length === 1
      ? storeNameMap.get(selectedStoreIds[0]) || '1 обект'
      : `${selectedStoreIds.length} обекта`

  const filteredStores = search
    ? stores.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : stores

  const inputClass = 'border rounded px-3 py-2 text-sm'

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">От</label>
        <input
          type="date"
          defaultValue={fromDate}
          onChange={e => update('from', e.target.value)}
          className={`${inputClass} w-[140px]`}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">До</label>
        <input
          type="date"
          defaultValue={toDate}
          onChange={e => update('to', e.target.value)}
          className={`${inputClass} w-[140px]`}
        />
      </div>
      {stores.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Обект</label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="justify-between gap-2 max-w-[220px]">
                <span className="truncate">{storeLabel}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[260px] p-0" align="start">
              {/* Search + quick actions */}
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Търси обект..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-8 pl-7 pr-2 text-sm border-0 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
                <div className="flex gap-1 mt-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={selectAllStores}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Всички
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={clearStoreFilter}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Изчисти
                  </Button>
                </div>
              </div>
              {/* Store list */}
              <div className="max-h-[240px] overflow-y-auto p-1">
                {filteredStores.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Няма намерени обекти</p>
                ) : (
                  filteredStores.map(s => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent text-sm"
                    >
                      <Checkbox
                        checked={selectedStoreIds.includes(s.id)}
                        onCheckedChange={() => toggleStore(s.id)}
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))
                )}
              </div>
              {/* Footer: selected count */}
              {selectedStoreIds.length > 0 && (
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  {selectedStoreIds.length} избрани
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}
      {categories.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Категория</label>
          <select
            defaultValue={category || ''}
            onChange={e => update('category', e.target.value)}
            className={`${inputClass} max-w-[180px]`}
          >
            <option value="">Всички категории</option>
            <option value="__none__">Без категория</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {products.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Продукт</label>
          <select
            defaultValue={product || ''}
            onChange={e => update('product', e.target.value)}
            className={`${inputClass} max-w-[220px]`}
          >
            <option value="">Всички продукти</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div className="flex items-center gap-1.5 pb-1">
        <input
          type="checkbox"
          id="grouped"
          defaultChecked={grouped === '1'}
          onChange={e => update('grouped', e.target.checked ? '1' : '')}
          className="h-4 w-4"
        />
        <label htmlFor="grouped" className="text-xs text-muted-foreground cursor-pointer select-none">
          Групирай по продукт
        </label>
      </div>
    </div>
  )
}
