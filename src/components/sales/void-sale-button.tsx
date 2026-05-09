'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Ban, Loader2 } from 'lucide-react'

export function VoidSaleButton({ saleId }: { saleId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleVoid = async () => {
    if (!confirmed) { setConfirmed(true); return }
    setLoading(true)
    try {
      const res = await fetch('/api/sales/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale_id: saleId }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Грешка')
        setConfirmed(false)
        return
      }
      router.refresh()
    } catch {
      alert('Грешка при сторниране')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className={`h-7 text-xs ${confirmed ? 'text-red-600 hover:text-red-700 bg-red-50' : 'text-muted-foreground hover:text-red-500'}`}
      onClick={handleVoid}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3 mr-1" />}
      {confirmed ? 'Сигурен?' : 'Сторно'}
    </Button>
  )
}
