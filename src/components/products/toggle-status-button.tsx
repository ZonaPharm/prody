'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

interface ToggleStatusButtonProps {
  productId: string
  currentStatus: string
}

export function ToggleStatusButton({ productId, currentStatus }: ToggleStatusButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
      await fetch('/api/products/toggle-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, status: newStatus }),
      })
      router.refresh()
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const isActive = currentStatus === 'active'

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      className={`absolute top-2 right-2 z-10 rounded-full w-7 h-7 flex items-center justify-center text-xs shadow transition-all ${
        isActive
          ? 'bg-green-500 text-white hover:bg-red-500'
          : 'bg-slate-400 text-white hover:bg-green-500'
      }`}
      title={isActive ? 'Деактивирай' : 'Активирай'}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isActive ? (
        <Eye className="h-3.5 w-3.5" />
      ) : (
        <EyeOff className="h-3.5 w-3.5" />
      )}
    </button>
  )
}
