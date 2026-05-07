'use client'

import { useEffect, useState } from 'react'

export function RequestsBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/inventory/requests/count')
        .then(r => r.json())
        .then(d => setCount(d.count || 0))
    }
    fetchCount()
    const interval = setInterval(fetchCount, 30000)
    return () => clearInterval(interval)
  }, [])

  if (count === 0) return null

  return (
    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
      {count}
    </span>
  )
}
