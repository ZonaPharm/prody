'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface Store {
  id: string
  name: string
  address: string | null
  is_active: boolean
}

export function StoresManager() {
  const [stores, setStores] = useState<Store[]>([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = useRef(createClient())

  const fetchStores = async () => {
    const { data } = await supabase.current.from('stores').select('*').order('name')
    setStores((data as Store[]) || [])
  }

  useEffect(() => {
    fetchStores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAdd = async () => {
    if (!name.trim()) return
    setError('')
    setLoading(true)
    try {
      await supabase.current.from('stores').insert({
        name: name.trim(),
        address: address.trim() || null,
      } as any)
      setName('')
      setAddress('')
      await fetchStores()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Грешка при добавяне на магазин.')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (store: Store) => {
    setError('')
    const updated = !store.is_active
    setStores((prev) =>
      prev.map((s) => (s.id === store.id ? { ...s, is_active: updated } : s))
    )
    try {
      await supabase.current
        .from('stores')
        // @ts-expect-error — supabase-js type inference limitation with @supabase/ssr
        .update({ is_active: updated })
        .eq('id', store.id)
    } catch (e) {
      setStores((prev) =>
        prev.map((s) => (s.id === store.id ? { ...s, is_active: !updated } : s))
      )
      setError(e instanceof Error ? e.message : 'Грешка при промяна на статус.')
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Име на магазин</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Нов магазин"
          />
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Адрес (незадължително)</label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Адрес"
          />
        </div>
        <Button onClick={handleAdd} disabled={loading || !name.trim()}>
          Добави
        </Button>
      </div>

      <div className="space-y-1">
        {stores.map((store) => (
          <div
            key={store.id}
            className="flex items-center gap-3 py-2 border-b"
          >
            <span className="flex-1 font-medium">{store.name}</span>
            <span className="text-sm text-muted-foreground">
              {store.address || '--'}
            </span>
            <Badge variant={store.is_active ? 'default' : 'destructive'}>
              {store.is_active ? 'Активен' : 'Неактивен'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleToggleActive(store)}
            >
              {store.is_active ? 'Деактивирай' : 'Активирай'}
            </Button>
          </div>
        ))}
        {stores.length === 0 && (
          <p className="text-muted-foreground text-sm">Няма създадени магазини.</p>
        )}
      </div>
    </div>
  )
}
