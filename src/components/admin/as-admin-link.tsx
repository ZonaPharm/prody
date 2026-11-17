'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * A link from the seller view ("Виж като продавач") to an admin page: it switches
 * back to the admin view first, because admin pages send a seller view to the POS.
 */
export function AsAdminLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function go(e: React.MouseEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      })
      if (res.ok) {
        router.push(href)
        router.refresh()
        return
      }
    } catch {
      // fall through
    }
    setBusy(false)
  }
  return (
    <a href={href} onClick={go} className={className} aria-busy={busy}>
      {children}
    </a>
  )
}
