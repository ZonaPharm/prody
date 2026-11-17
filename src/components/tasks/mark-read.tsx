'use client'

import { useEffect } from 'react'

/**
 * Once "Задачи" has been on screen for a moment, its new notifications count as
 * read. They stay marked "ново" on this view; the count in the menu drops on the
 * next screen.
 */
export function MarkRead({ ids }: { ids: string[] }) {
  const key = ids.join(',')
  useEffect(() => {
    if (!key) return
    const timer = setTimeout(() => {
      fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: key.split(',') }),
      }).catch(() => {})
    }, 1500)
    return () => clearTimeout(timer)
  }, [key])
  return null
}
