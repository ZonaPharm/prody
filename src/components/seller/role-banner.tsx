'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Eye, Loader2 } from 'lucide-react'

export function RoleBanner() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSwitchBack = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      })
      if (res.ok) {
        router.push('/dashboard')
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3 mb-4">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 text-yellow-700" />
        <span className="text-sm font-medium text-yellow-800">Вие сте в режим Продавач</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSwitchBack}
        disabled={loading}
        className="border-yellow-300 text-yellow-800 hover:bg-yellow-100"
      >
        {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
        Обратно към админ
      </Button>
    </div>
  )
}
