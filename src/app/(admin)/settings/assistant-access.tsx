'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Hint, Meta, Note, SectionTitle } from '@/components/ui/text'

type Admin = { id: string; name: string; granted: boolean; spent_usd: number }
type State = { configured: boolean; monthly_cap_usd: number; spent_usd: number; admins: Admin[] }

/** Настройки → AI → „AI асистент“: who may use it and the monthly cap. */
export function AssistantAccess() {
  const [state, setState] = useState<State | null>(null)
  const [cap, setCap] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/assistant/access', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Не успях да заредя настройките.'); return }
    setError('')
    setState(data)
    setCap(String(data.monthly_cap_usd))
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(a: Admin, enabled: boolean) {
    setSaving(a.id); setSaved(''); setError('')
    const res = await fetch('/api/assistant/access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: a.id, enabled }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(null)
    if (!res.ok) { setError(data.error || 'Записът не успя.'); return }
    setSaved(enabled ? `${a.name} вече има достъп.` : `${a.name} вече няма достъп.`)
    load()
  }

  async function saveCap() {
    const v = Number(cap.replace(',', '.'))
    if (!Number.isFinite(v) || v < 0) { setError('Таванът трябва да е число, 0 или повече.'); return }
    setSaving('cap'); setSaved(''); setError('')
    const res = await fetch('/api/assistant/access', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_cap_usd: v }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(null)
    if (!res.ok) { setError(data.error || 'Записът не успя.'); return }
    setSaved('Таванът е записан.')
    load()
  }

  return (
    <div className="mt-8 space-y-4 border-t pt-6">
      <SectionTitle>AI асистент</SectionTitle>
      <Hint>Отметнете кой администратор да вижда „AI асистент“ в менюто. Асистентът само чете: продажби, наличности, доставки, заявки и дневника.</Hint>
      {error && <Note tone="danger">{error}</Note>}
      {saved && <Note tone="success">{saved}</Note>}
      {state && !state.configured && (
        <Note tone="warn">Липсва ключът ANTHROPIC_API_KEY във Vercel. Без него асистентът не може да отговаря.</Note>
      )}
      {!state && !error && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      {state && (
        <>
          <div className="divide-y rounded-md border bg-white">
            {state.admins.map(a => (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                <Checkbox
                  checked={a.granted}
                  disabled={saving !== null}
                  onCheckedChange={v => toggle(a, v === true)}
                />
                <span className="flex-1 text-sm">{a.name}</span>
                {a.spent_usd > 0 && <Meta as="span">{a.spent_usd.toFixed(2)} $ този месец</Meta>}
                {saving === a.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </label>
            ))}
          </div>
          <Meta>Достъп може да има само администратор: асистентът вижда продажбите, а Офис не бива да ги вижда.</Meta>

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="ai-cap">Месечен таван ($)</Label>
              <Input id="ai-cap" inputMode="decimal" value={cap} onChange={e => setCap(e.target.value)} className="w-32" />
            </div>
            <Button variant="outline" onClick={saveCap} disabled={saving !== null}>
              {saving === 'cap' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Запази тавана
            </Button>
          </div>
          <Meta>Похарчени този месец: {state.spent_usd.toFixed(2)} $. Щом стигнат тавана, асистентът спира до 1-во число.</Meta>
        </>
      )}
    </div>
  )
}
