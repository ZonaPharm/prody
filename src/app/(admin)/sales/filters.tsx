'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'

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

  const toggleStore = (storeId: string) => {
    const next = selectedStoreIds.includes(storeId)
      ? selectedStoreIds.filter(id => id !== storeId)
      : [...selectedStoreIds, storeId]
    update('store', next.join(','))
  }

  const selectAll = () => update('store', '')
  const storeLabel = selectedStoreIds.length === 0
    ? 'Всички обекти'
    : selectedStoreIds.length === 1
      ? storeNameMap.get(selectedStoreIds[0]) || '1 обект'
      : `${selectedStoreIds.length} обекта`

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="justify-between gap-2 max-w-[220px]">
                <span className="truncate">{storeLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[220px]" align="start">
              <DropdownMenuLabel className="text-xs">Филтрирай по обект</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={selectedStoreIds.length === 0}
                onCheckedChange={selectAll}
              >
                Всички обекти
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {stores.map(s => (
                <DropdownMenuCheckboxItem
                  key={s.id}
                  checked={selectedStoreIds.includes(s.id)}
                  onCheckedChange={() => toggleStore(s.id)}
                >
                  {s.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
