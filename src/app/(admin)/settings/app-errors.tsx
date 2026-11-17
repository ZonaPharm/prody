'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SectionTitle, Hint, Note, Meta, Empty } from '@/components/ui/text'
import { sofiaDateTime } from '@/lib/date-utils'
import { parseRecipients } from '@/lib/errors/shape'

interface AppError {
  id: string
  source: 'server' | 'browser'
  kind: string
  message: string
  stack: string | null
  path: string | null
  method: string | null
  digest: string | null
  release: string | null
  user_name: string | null
  user_agent: string | null
  count: number
  first_seen: string
  last_seen: string
  resolved_at: string | null
  notified_at: string | null
}

const KIND_LABELS: Record<string, string> = {
  route: 'заявка към сървъра',
  render: 'зареждане на страница',
  action: 'действие от формуляр',
  proxy: 'проверка за вход',
  log: 'записано от кода',
  window: 'скрипт в браузъра',
  promise: 'незавършена операция в браузъра',
  boundary: 'екран „Нещо се обърка“',
  global: 'приложението не се зареди',
}

/** Настройки → Грешки: what went wrong, how often, where and for whom. */
export function AppErrors() {
  const [status, setStatus] = useState<'open' | 'all'>('open')
  const [errors, setErrors] = useState<AppError[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const res = await fetch(`/api/errors?status=${status}`)
      const data = await res.json()
      if (!res.ok || !Array.isArray(data)) throw new Error()
      setErrors(data)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  async function setResolved(e: AppError, resolved: boolean) {
    setBusy(e.id)
    try {
      const res = await fetch(`/api/errors/${e.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved }),
      })
      if (res.ok) {
        const data = await res.json()
        setErrors(list => status === 'open' && resolved
          ? list.filter(x => x.id !== e.id)
          : list.map(x => x.id === e.id ? { ...x, resolved_at: data.resolved_at } : x))
      }
    } finally {
      setBusy(null)
    }
  }

  function toggle(id: string) {
    setOpen(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <AlertRecipients />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <SectionTitle
            count={!loading && !loadFailed ? `${errors.length}${errors.length === 200 ? '+' : ''} ${status === 'open' ? 'неоправени' : 'общо'}` : undefined}
            action={<Button variant="outline" size="sm" onClick={load} disabled={loading}>Обнови</Button>}
          >
            Грешки
          </SectionTitle>
          <Hint small>
            Тук влиза всяка грешка от сървъра и от телефоните и компютрите. Една и съща грешка не се повтаря, а се брои.
            Когато е оправена, натиснете „Оправено“. Ако се появи пак, се връща в списъка.
          </Hint>

          <div className="flex w-fit gap-1 rounded-md bg-muted p-1">
            {(['open', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                  status === s ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {s === 'open' ? 'Неоправени' : 'Всички'}
              </button>
            ))}
          </div>

          {loading ? (
            <Meta className="py-6 text-center">Зареждане…</Meta>
          ) : loadFailed ? (
            <Note tone="danger">Грешките не можаха да се заредят. Опитайте „Обнови“.</Note>
          ) : errors.length === 0 ? (
            <Empty>{status === 'open' ? 'Няма неоправени грешки.' : 'Няма записани грешки.'}</Empty>
          ) : (
            <ul className="space-y-2">
              {errors.map(e => {
                const expanded = open.has(e.id)
                return (
                  <li key={e.id} className={`rounded-md border p-3 ${e.resolved_at ? 'bg-slate-50 opacity-75' : 'bg-white'}`}>
                    <div className="flex flex-wrap items-start gap-2">
                      <p className={`min-w-0 flex-1 break-words font-mono text-sm text-red-800 ${expanded ? '' : 'line-clamp-3'}`}>
                        {e.message}
                      </p>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" size="sm" onClick={() => toggle(e.id)}>
                          {expanded ? 'Скрий' : 'Подробности'}
                        </Button>
                        {e.resolved_at ? (
                          <Button variant="outline" size="sm" disabled={busy === e.id} onClick={() => setResolved(e, false)}>
                            Отвори пак
                          </Button>
                        ) : (
                          <Button size="sm" disabled={busy === e.id} onClick={() => setResolved(e, true)}>
                            Оправено
                          </Button>
                        )}
                      </div>
                    </div>
                    <Meta className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {e.source === 'browser' ? 'Браузър' : 'Сървър'}
                      </Badge>
                      <span className="font-medium text-slate-700">{e.count === 1 ? '1 път' : `${e.count} пъти`}</span>
                      <span>последно {sofiaDateTime(e.last_seen)}</span>
                      {e.path && <span className="font-mono">{e.path}</span>}
                      {e.user_name && <span>{e.user_name}</span>}
                      {e.resolved_at && <span className="text-emerald-700">оправено {sofiaDateTime(e.resolved_at)}</span>}
                    </Meta>
                    {expanded && (
                      <div className="mt-3 space-y-2">
                        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                          <dt className="text-slate-500">Къде</dt><dd>{KIND_LABELS[e.kind] || e.kind}{e.method ? ` (${e.method})` : ''}</dd>
                          <dt className="text-slate-500">За първи път</dt><dd>{sofiaDateTime(e.first_seen)}</dd>
                          {e.digest && <><dt className="text-slate-500">Код</dt><dd className="font-mono">{e.digest}</dd></>}
                          {e.release && <><dt className="text-slate-500">Версия</dt><dd className="font-mono">{e.release}</dd></>}
                          <dt className="text-slate-500">Имейл</dt><dd>{e.notified_at ? `изпратен ${sofiaDateTime(e.notified_at)}` : 'още не'}</dd>
                          {e.user_agent && <><dt className="text-slate-500">Устройство</dt><dd className="break-words">{e.user_agent}</dd></>}
                        </dl>
                        {e.stack && (
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-100 p-2 text-[11px] leading-snug text-slate-700">
                            {e.stack}
                          </pre>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Who gets the e-mail when a new error appears. */
function AlertRecipients() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<string[] | null>(null)
  const [smtpReady, setSmtpReady] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/errors/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setSaved(d.error_alert_to)
        setText(d.error_alert_to.join(', '))
        setSmtpReady(d.smtp_ready)
      })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/errors/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error_alert_to: parseRecipients(text) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'danger', text: data.error || 'Не можа да се запише' })
        return
      }
      setSaved(data.error_alert_to)
      setText(data.error_alert_to.join(', '))
      setMessage({ tone: 'success', text: data.error_alert_to.length ? 'Запазено.' : 'Запазено. Няма да идват имейли.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <SectionTitle>Имейл при нова грешка</SectionTitle>
        <Meta>
          Идва при нов вид грешка и когато оправена грешка се появи пак. Най-много един имейл на час, със събраните нови грешки.
        </Meta>
        {saved !== null && saved.length === 0 && (
          <Note tone="warn" small>Не е въведен имейл, затова за новите грешки не идва известие.</Note>
        )}
        {!smtpReady && (
          <Note tone="warn" small>Пощата не е настроена (раздел „Имейл“), затова имейл няма да тръгне.</Note>
        )}
        <div className="flex flex-wrap gap-2">
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="ime@primer.bg"
            className="min-w-0 flex-1 sm:max-w-md"
            aria-label="Имейли за известия, разделени със запетая"
          />
          <Button onClick={save} disabled={saving}>Запази</Button>
        </div>
        <Meta>Няколко адреса се разделят със запетая.</Meta>
        {message && <Note tone={message.tone} small>{message.text}</Note>}
      </CardContent>
    </Card>
  )
}
