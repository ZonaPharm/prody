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
    <div className={`rounded-md px-3 py-2 text-xs font-medium text-center transition-colors cursor-pointer ${
      isSeller
        ? 'border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
        : 'border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
    }`} onClick={handleSwitch}>
      {loading ? (
        <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
      ) : null}
      {isSeller ? 'Виж като продавач' : 'Върни се като админ'}
    </div>
  )
}
