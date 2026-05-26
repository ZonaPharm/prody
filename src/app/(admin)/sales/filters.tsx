'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface SalesFiltersProps {
  fromDate: string
  toDate: string
  store?: string
  product?: string
  category?: string
  stores: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  products: { id: string; name: string }[]
}

export function SalesFilters({ fromDate, toDate, store, product, category, stores, categories, products }: SalesFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const update = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete('page') // reset to page 1
    router.replace(`/sales?${params.toString()}`)
  }

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
          <select
            defaultValue={store || ''}
            onChange={e => update('store', e.target.value)}
            className={`${inputClass} max-w-[180px]`}
          >
            <option value="">Всички обекти</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
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
    </div>
  )
}
