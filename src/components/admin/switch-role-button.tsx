'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface SwitchRoleButtonProps {
  targetRole?: 'seller' | 'admin'
}

export function SwitchRoleButton({ targetRole = 'seller' }: SwitchRoleButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSwitch = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: targetRole }),
      })
      if (res.ok) {
        router.push(targetRole === 'seller' ? '/record-sale' : '/dashboard')
        router.refresh()
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const isSeller = targetRole === 'seller'

  return (
    <button type="button" className={`w-full rounded-lg px-3 py-2 text-sm font-medium text-center transition-colors ${
      isSeller
        ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
        : 'border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100'
    }`} onClick={handleSwitch} disabled={loading}>
      {loading ? (
        <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
      ) : null}
      {isSeller ? 'Виж като продавач' : 'Върни се като админ'}
    </button>
  )
}
