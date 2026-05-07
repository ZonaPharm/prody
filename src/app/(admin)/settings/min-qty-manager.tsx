'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Save } from 'lucide-react'

interface Product {
  id: string
  name: string
  min_quantity: number | null
}

export function MinQtyManager({ products }: { products: Product[] }) {
  const router = useRouter()
  const [minQtys, setMinQtys] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    products.forEach(p => { map[p.id] = p.min_quantity ?? 5 })
    return map
  })
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())

  const saveOne = async (productId: string) => {
    setSaving(productId)
    try {
      await fetch('/api/products/update-min-qty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: productId, min_quantity: minQtys[productId] }),
      })
      setSaved(prev => new Set([...prev, productId]))
      setTimeout(() => setSaved(prev => {
        const next = new Set(prev)
        next.delete(productId)
        return next
      }), 2000)
    } finally {
      setSaving(null)
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Минимални количества по продукти</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Продукт</th>
                <th className="text-center px-4 py-3 font-medium w-32">Мин. к-во</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2">
                    <Input
                      type="number"
                      min="0"
                      className="w-20 h-8 text-sm mx-auto text-center"
                      value={minQtys[p.id] ?? 5}
                      onChange={e => setMinQtys(prev => ({ ...prev, [p.id]: parseInt(e.target.value) || 0 }))}
                    />
                  </td>
                  <td className="px-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saving === p.id}
                      onClick={() => saveOne(p.id)}
                    >
                      {saving === p.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : saved.has(p.id) ? (
                        <span className="text-green-600 text-xs">✓</span>
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
