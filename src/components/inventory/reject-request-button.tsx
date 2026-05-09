'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { X, Loader2 } from 'lucide-react'

export function RejectRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const handleReject = async () => {
    if (!confirmed) { setConfirmed(true); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/inventory/requests/${requestId}/reject`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Грешка')
        setConfirmed(false)
        return
      }
      router.refresh()
    } catch {
      alert('Грешка при отказване')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      className={`h-7 text-xs ${confirmed ? 'text-red-600 bg-red-50' : 'text-muted-foreground hover:text-red-500'}`}
      onClick={handleReject}
      disabled={loading}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3 mr-1" />}
      {confirmed ? 'Сигурен?' : 'Откажи'}
    </Button>
  )
}
