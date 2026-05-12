'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Download, RefreshCw, Database } from 'lucide-react'

interface Backup {
  name: string
  size: number
  created: string
}

export function BackupSettings() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [backing, setBacking] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchBackups = useCallback(async () => {
    try {
      const res = await fetch('/api/backups')
      const data = await res.json()
      if (res.ok) {
        setBackups(data.backups || [])
        setError(null)
      } else {
        setError(data.error)
      }
    } catch {
      setError('Грешка при зареждане на бекъпи')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBackups()
  }, [fetchBackups])

  async function triggerBackup() {
    setBacking(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/backups/trigger', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setResult(`Бекъпът е създаден успешно. ${data.rows} реда в ${data.tables} таблици.`)
        fetchBackups()
      } else {
        setError(data.error || 'Грешка при бекъп')
      }
    } catch {
      setError('Грешка при бекъп')
    } finally {
      setBacking(false)
    }
  }

  async function downloadBackup(name: string) {
    try {
      const res = await fetch(`/api/backups/download/${name}`)
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch {
      setError('Грешка при сваляне на бекъп')
    }
  }

  function formatSize(bytes: number) {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDate(date: string) {
    return new Date(date).toLocaleString('bg-BG')
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Бекъп на базата данни
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Автоматичен бекъп всеки ден в 3:00 сутринта. Запазват се последните 7 бекъпа.
            Бекъпът се изпраща и на имейла на администраторите.
          </p>

          <div className="flex items-center gap-3">
            <Button onClick={triggerBackup} disabled={backing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${backing ? 'animate-spin' : ''}`} />
              {backing ? 'Създаване...' : 'Създай бекъп сега'}
            </Button>
          </div>

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-800">
              {result}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Последни бекъпи</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Зареждане...</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Няма намерени бекъпи.</p>
          ) : (
            <div className="space-y-2">
              {backups.slice(0, 7).map((b) => (
                <div
                  key={b.name}
                  className="flex items-center justify-between py-2 px-3 border rounded-md"
                >
                  <div>
                    <p className="text-sm font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(b.created)} · {formatSize(b.size)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadBackup(b.name)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
