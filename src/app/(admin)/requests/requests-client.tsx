'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, X, Loader2 } from 'lucide-react'

interface Request {
  id: string
  product_name: string
  store_name: string
  quantity: number
  status: string
  notes: string | null
  created_at: string
}

export function RequestsClient({ requests: initialRequests }: { requests: Request[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [loading, setLoading] = useState<string | null>(null)

  const fulfill = async (id: string) => {
    setLoading(id)
    await fetch(`/api/inventory/requests/${id}/fulfill`, { method: 'POST' })
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'fulfilled' } : r))
    setLoading(null)
    router.refresh()
  }

  const pending = requests.filter(r => r.status === 'pending')
  const fulfilled = requests.filter(r => r.status === 'fulfilled')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Заявки за зареждане</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {pending.length} чакащи · {fulfilled.length} изпълнени
        </p>
      </div>

      {pending.length === 0 && fulfilled.length === 0 ? (
        <div className="rounded-md border bg-white p-12 text-center text-muted-foreground">
          <p>Няма заявки</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending */}
          {pending.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
                Чакащи
                <Badge variant="destructive" className="text-[10px]">{pending.length}</Badge>
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Магазин</th>
                      <th className="text-center px-4 py-3 font-medium">Кол.</th>
                      <th className="text-right px-4 py-3 font-medium">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(req => (
                      <tr key={req.id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-600 border-green-300 hover:bg-green-50"
                            onClick={() => fulfill(req.id)}
                            disabled={loading === req.id}
                          >
                            {loading === req.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                            Изпълни
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Fulfilled */}
          {fulfilled.length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-muted-foreground">
                Изпълнени ({fulfilled.length})
              </h2>
              <div className="rounded-lg border bg-white overflow-hidden opacity-60">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Продукт</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Магазин</th>
                      <th className="text-center px-4 py-3 font-medium">Кол.</th>
                      <th className="text-right px-4 py-3 font-medium">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fulfilled.map(req => (
                      <tr key={req.id} className="border-b last:border-0">
                        <td className="px-4 py-3">{req.product_name}</td>
                        <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{req.store_name}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{req.quantity} бр.</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="bg-green-100 text-green-800 text-[10px]">Изпълнена</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
