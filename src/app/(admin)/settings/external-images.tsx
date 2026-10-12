'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImageDown } from 'lucide-react'

export function ExternalImages() {
  const [count, setCount] = useState<number | null>(null)
  const [hosts, setHosts] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/products/rehost-images')
      const data = await res.json()
      if (res.ok) {
        setCount(data.count)
        setHosts(data.hosts || [])
      }
    } catch {
      // The count is a convenience; the card still works without it.
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function move() {
    setWorking(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/products/rehost-images', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Грешка при преместване')
      } else if (data.failed > 0) {
        setError(`Преместени ${data.moved}, неуспешни ${data.failed}: ${data.errors.map((e: { error: string }) => e.error).join('; ')}`)
      } else {
        setResult(`Преместени ${data.moved} снимки. Спестени ${data.savedKb} KB.`)
      }
      refresh()
    } catch {
      setError('Грешка при преместване')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageDown className="h-5 w-5" />
          Снимки от външни сайтове
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Снимка, която се зарежда от друг сайт, може да спре да се показва, ако този сайт я премести,
          изтрие или ограничи достъпа. Преместването прави копие в Prody и продуктът започва да ползва него.
          Оригиналът не се пипа.
        </p>

        <p className="text-sm">
          {count === null
            ? 'Проверка…'
            : count === 0
              ? 'Всички снимки са в Prody.'
              : `${count} ${count === 1 ? 'снимка се зарежда' : 'снимки се зареждат'} от ${hosts.join(', ')}.`}
        </p>

        <div className="flex items-center gap-3">
          <Button onClick={move} disabled={working || count === 0 || count === null}>
            <ImageDown className={`mr-2 h-4 w-4 ${working ? 'animate-pulse' : ''}`} />
            {working ? 'Преместване…' : 'Премести в Prody'}
          </Button>
        </div>

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800">
            {result}
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
