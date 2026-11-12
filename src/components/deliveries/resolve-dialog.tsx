'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, PenLine } from 'lucide-react'
import { resolutionOptions, resolveError, type Resolution } from '@/lib/deliveries/resolve'
import { sofiaDateTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { postJson, useNow } from './checklist-ui'

/** "Реши": the admin picks a decision, adds a note and signs (resolve_signal). */
export function ResolveButton({ signalId, step, title, userName }: { signalId: string; step: string; title: string; userName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Реши</Button>
      {open && <ResolveDialog signalId={signalId} step={step} title={title} userName={userName} onClose={() => setOpen(false)} />}
    </>
  )
}

function ResolveDialog({ signalId, step, title, userName, onClose }: {
  signalId: string
  step: string
  title: string
  userName: string
  onClose: () => void
}) {
  const router = useRouter()
  const now = useNow()
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = resolutionOptions(step)

  async function submit() {
    const err = resolveError(resolution, note)
    if (err) return setError(err)
    setBusy(true)
    setError('')
    try {
      await postJson(`/api/deliveries/signals/${signalId}/resolve`, { resolution, note: note.trim() || null }, 'Сигналът не беше решен')
      onClose()
      router.refresh()
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Решение: {title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {options.map(o => (
            <button key={o.value} type="button" onClick={() => { setResolution(o.value); setError('') }}
              className={cn('w-full rounded-md border px-3 py-2 text-left text-sm', resolution === o.value ? 'border-slate-900 bg-slate-900 text-white' : 'hover:bg-slate-50')}>
              <span className="font-medium">{o.label}</span>
              <span className={cn('block text-xs', resolution === o.value ? 'text-slate-200' : 'text-muted-foreground')}>{o.effect}</span>
            </button>
          ))}
        </div>
        <label className="block text-sm space-y-1">
          <span>Бележка{resolution === 'other' ? '' : ' (по избор)'}</span>
          <Input value={note} onChange={e => setNote(e.target.value)} aria-label="Бележка" />
        </label>
        <p className="text-sm text-muted-foreground">{userName} · {sofiaDateTime(now)}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Назад</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}Подписвам
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
