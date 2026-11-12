'use client'

import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

export function ExportButton() {
  const searchParams = useSearchParams()

  function handleExport() {
    const params = new URLSearchParams(searchParams.toString())
    const url = `/api/catalog/export?${params.toString()}`
    window.open(url, '_blank')
  }

  return (
    <Button variant="outline" onClick={handleExport} aria-label="Експорт" className="px-3 sm:px-4">
      <Download className="h-4 w-4 sm:mr-2" />
      <span className="hidden sm:inline">Експорт</span>
    </Button>
  )
}
