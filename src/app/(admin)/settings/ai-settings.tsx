'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

export function AiSettings() {
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/ai-instructions')
      .then(r => r.json())
      .then(d => { if (d.instructions) setInstructions(d.instructions) })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/settings/ai-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions }),
      })
      if (!res.ok) throw new Error('Грешка при запис')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Грешка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">{error}</div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md text-sm">Запазено успешно</div>
      )}
      <div className="space-y-2">
        <Label htmlFor="ai-instructions">AI инструкции за пренаписване на описание</Label>
        <Textarea
          id="ai-instructions"
          rows={6}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Пример: Пиши на професионален български. Включи основни характеристики и технически детайли. Избягвай маркетингови фрази."
        />
        <p className="text-xs text-muted-foreground">
          Тези инструкции ще се използват когато натиснеш &quot;Пренапиши с AI&quot; върху описание на продукт.
        </p>
      </div>
      <Button onClick={handleSave} disabled={loading}>
        {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Записване...</> : 'Запази инструкциите'}
      </Button>
    </div>
  )
}
