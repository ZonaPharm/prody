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
    <Button variant="outline" onClick={handleExport}>
      <Download className="mr-2 h-4 w-4" />
      Експорт
    </Button>
  )
}
