'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Category {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  sort_order: number
}

export function CategoriesManager() {
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = useRef(createClient())

  const fetchCategories = async () => {
    const { data } = await supabase.current
      .from('categories')
      .select('*')
      .order('sort_order')
    setCategories((data as Category[]) || [])
  }

  useEffect(() => {
    fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAdd = async () => {
    if (!name.trim()) return
    setError('')
    setLoading(true)
    try {
      await supabase.current.from('categories').insert({
        name: name.trim(),
        parent_id: parentId,
      } as any)
      setName('')
      setParentId(null)
      await fetchCategories()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Грешка при добавяне на категория.')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setError('')
    setLoading(true)
    try {
      await supabase.current.from('categories').delete().eq('id', id)
      await fetchCategories()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Грешка при изтриване на категория.')
    } finally {
      setLoading(false)
    }
  }

  const topLevelCategories = categories.filter((c) => !c.parent_id)

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Име на категория</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Нова категория"
          />
        </div>
        <div className="w-64">
          <label className="text-sm font-medium mb-1 block">Родителска категория</label>
          <Select
            value={parentId || 'none'}
            onValueChange={(v) => setParentId(v === 'none' ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Без родител" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без родител</SelectItem>
              {topLevelCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleAdd} disabled={loading || !name.trim()}>
          Добави
        </Button>
      </div>

      <div className="space-y-1">
        {categories
          .filter((c) => !c.parent_id)
          .map((parent) => (
            <div key={parent.id}>
              <div className="flex items-center gap-2 py-1 border-b">
                <span className="flex-1 font-medium">{parent.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => handleDelete(parent.id)}
                  disabled={loading}
                >
                  Изтрий
                </Button>
              </div>
              {categories
                .filter((c) => c.parent_id === parent.id)
                .map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 py-1 border-b ml-6"
                  >
                    <span className="flex-1 text-muted-foreground">
                      {'↳'} {child.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(child.id)}
                      disabled={loading}
                    >
                      Изтрий
                    </Button>
                  </div>
                ))}
            </div>
          ))}
        {categories.length === 0 && (
          <p className="text-muted-foreground text-sm">Няма създадени категории.</p>
        )}
      </div>
    </div>
  )
}
