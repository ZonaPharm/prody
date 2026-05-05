'use client'

import { useState, useEffect } from 'react'
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
  const supabase = createClient()

  const fetchStores = async () => {
    const { data } = await supabase.from('stores').select('*').order('name')
    setStores((data as Store[]) || [])
  }

  useEffect(() => {
    fetchStores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAdd = async () => {
    if (!name.trim()) return
    setLoading(true)
    await supabase.from('stores').insert({
      name: name.trim(),
      address: address.trim() || null,
    } as any)
    setName('')
    setAddress('')
    await fetchStores()
    setLoading(false)
  }

  const handleToggleActive = async (store: Store) => {
    setLoading(true)
    await supabase
      .from('stores')
      // @ts-expect-error — supabase-js type inference limitation with @supabase/ssr
      .update({ is_active: !store.is_active })
      .eq('id', store.id)
    await fetchStores()
    setLoading(false)
  }

  return (
    <div className="space-y-6">
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
              disabled={loading}
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
