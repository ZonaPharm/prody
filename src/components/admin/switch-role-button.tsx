'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Eye, Shield, Loader2 } from 'lucide-react'

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

  return (
    <Button
      variant="ghost"
      className="w-full justify-start text-slate-400 hover:text-white"
      onClick={handleSwitch}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : targetRole === 'seller' ? (
        <Eye className="mr-2 h-4 w-4" />
      ) : (
        <Shield className="mr-2 h-4 w-4" />
      )}
      {targetRole === 'seller' ? 'Виж като продавач' : 'Върни се като админ'}
    </Button>
  )
}
