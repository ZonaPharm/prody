'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquarePlus, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Hint, Meta, Note, PageHeader } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { Answer } from './answer'
import { ActionCardView } from './action-card'
import type { ActionCard } from '@/lib/assistant/cards'

type Msg = { role: 'user' | 'assistant'; text: string; card?: undefined } | { role: 'card'; card: ActionCard; text?: undefined }

const ACCEPT = 'image/*,.pdf,.xlsx,.xls,.csv,.ods,.txt'
const MAX_FILE = 10 * 1024 * 1024
type Conversation = { id: string; title: string; updated_at: string }

const EXAMPLES = [
  'Колко продадохме тази седмица по магазини?',
  'Кои продукти са под минимума в Офис?',
  'Има ли зависнали пратки или отворени проблеми по доставките?',
  'Какво е правил вчера в Prody всеки от екипа?',
  'Направи ми Excel с продажбите по обекти за миналия месец',
]

export function AssistantChat() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [status, setStatus] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState<{ configured: boolean; blocked: string | null; spent: string; cap: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    const res = await fetch('/api/assistant', { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Не успях да заредя разговорите.'); return }
    setConversations(data.conversations || [])
    setInfo({ configured: data.configured, blocked: data.blocked, spent: data.spent, cap: data.cap })
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, status])

  async function openConversation(id: string) {
    if (busy) return
    setError('')
    setCurrentId(id)
    setMessages([])
    const res = await fetch(`/api/assistant/conversations/${id}`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Не успях да отворя разговора.'); return }
    setMessages((data.items || []).map((it: any) => (it.type === 'card' ? { role: 'card', card: it.card } : { role: it.role, text: it.text })))
  }

  function newConversation() {
    if (busy) return
    setCurrentId(null)
    setMessages([])
    setError('')
  }

  function pickFile(f: File | null) {
    if (f && f.size > MAX_FILE) { setError('Файлът е над 10 MB. Снимайте или изрежете само нужното.'); return }
    setError('')
    setFile(f)
  }

  async function ask(question: string) {
    const attached = file
    const q = question.trim() || (attached ? 'Разчети прикачения документ.' : '')
    if (!q || busy) return
    setBusy(true)
    setError('')
    setStatus([])
    setInput('')
    setFile(null)
    setMessages(m => [...m, { role: 'user', text: attached ? `${q}\n📎 ${attached.name}` : q }])
    let answered = false
    const cards: ActionCard[] = []
    try {
      let body: BodyInit
      const headers: Record<string, string> = {}
      if (attached) {
        const form = new FormData()
        form.set('question', q)
        if (currentId) form.set('conversation_id', currentId)
        form.set('file', attached)
        body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify({ conversation_id: currentId, question: q })
      }
      const res = await fetch('/api/assistant', { method: 'POST', headers, body })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Въпросът не стигна до асистента.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const ev = JSON.parse(line)
          if (ev.type === 'conversation') setCurrentId(ev.id)
          else if (ev.type === 'status') setStatus(s => (s[s.length - 1] === ev.text ? s : [...s, ev.text]))
          else if (ev.type === 'card') cards.push(ev.card)
          else if (ev.type === 'answer') {
            answered = true
            // The cards go under the answer that explains them.
            setMessages(m => [...m, { role: 'assistant', text: ev.text }, ...cards.map(card => ({ role: 'card' as const, card }))])
          }
          else if (ev.type === 'error') throw new Error(ev.text)
        }
      }
      if (!answered) throw new Error('Връзката прекъсна преди отговора. Опитайте пак.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка.')
      // The question was not stored: put it back so it can be sent again.
      if (!answered) {
        setMessages(m => [...m.slice(0, -1), ...cards.map(card => ({ role: 'card' as const, card }))])
        setInput(question)
        setFile(attached)
      }
    } finally {
      setBusy(false)
      setStatus([])
      loadList()
    }
  }

  const blocked = info && (!info.configured
    ? 'AI асистентът още не е настроен: липсва ключът DEEPSEEK_API_KEY във Vercel.'
    : info.blocked)

  return (
        <div className="flex h-[calc(100dvh-5.5rem-var(--bottom-nav-h,4rem))] min-h-[24rem] flex-col gap-3 lg:h-[calc(100dvh-3rem)]">
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600" aria-hidden />AI асистент</span>}
        intro={<span className="hidden sm:inline">Питайте за наличности, продажби, доставки и заявки. Прикачете фактура, за да подготви чернова на доставка. Нищо не се записва без Вашия бутон.</span>}
        actions={<Button variant="outline" size="sm" onClick={newConversation} disabled={busy}><MessageSquarePlus className="mr-1.5 h-4 w-4" />Нов разговор</Button>}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Earlier conversations: a column on a computer, a picker on a phone. */}
        <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto rounded-md border bg-white md:flex">
          <p className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">Разговори</p>
          {conversations.length === 0 && <p className="px-3 py-3 text-sm italic text-slate-500">Още няма.</p>}
          {conversations.map(c => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              disabled={busy}
              className={cn('border-b px-3 py-2 text-left text-sm hover:bg-slate-50', c.id === currentId && 'bg-violet-50 font-medium')}
            >
              <span className="line-clamp-2">{c.title}</span>
            </button>
          ))}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col rounded-md border bg-white">
          {conversations.length > 0 && (
            <div className="border-b p-2 md:hidden">
              <select
                className="w-full rounded-md border bg-white px-2 py-2 text-sm"
                value={currentId ?? ''}
                disabled={busy}
                onChange={e => (e.target.value ? openConversation(e.target.value) : newConversation())}
                aria-label="Разговор"
              >
                <option value="">Нов разговор</option>
                {conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
            {messages.length === 0 && !busy && (
              <div className="space-y-3">
                <Hint>Напишете въпрос най-долу или изберете пример.</Hint>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map(ex => (
                    <button
                      key={ex}
                      onClick={() => ask(ex)}
                      disabled={!!blocked}
                      className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-left text-sm text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => m.role === 'card' ? (
              <div key={m.card.id} className="max-w-[92%] sm:max-w-[80%]"><ActionCardView card={m.card} /></div>
            ) : (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[92%] rounded-lg px-3 py-2 text-sm sm:max-w-[80%]',
                  m.role === 'user' ? 'whitespace-pre-wrap bg-slate-900 text-white' : 'border bg-slate-50 text-slate-900',
                )}>
                  {m.role === 'user' ? m.text : <Answer text={m.text} />}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-start gap-2 text-sm text-slate-600">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-violet-600" aria-hidden />
                <div>
                  {status.length === 0 ? <p>Мисля…</p> : status.map((s, i) => <p key={i} className={i < status.length - 1 ? 'text-slate-400' : ''}>{s}</p>)}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="space-y-2 border-t p-2 sm:p-3">
            {error && <Note tone="danger" small>{error}</Note>}
            {blocked && <Note tone="warn" small>{blocked}</Note>}
            {file && (
              <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-2 py-1 text-xs">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} aria-label="Махни файла" className="text-slate-500 hover:text-slate-900"><X className="h-4 w-4" /></button>
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={e => { e.preventDefault(); ask(input) }}
            >
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                onChange={e => { pickFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
              <Button type="button" variant="outline" className="h-11 w-11 shrink-0 px-0" disabled={busy || !!blocked}
                onClick={() => fileRef.current?.click()} aria-label="Прикачи снимка, PDF или Excel" title="Прикачи снимка, PDF или Excel">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input) }
                }}
                placeholder="Въпрос към асистента…"
                rows={2}
                maxLength={4000}
                disabled={busy || !!blocked}
                className="min-h-[2.75rem] flex-1 resize-none text-base sm:text-sm"
              />
              <Button type="submit" disabled={busy || (!input.trim() && !file) || !!blocked} className="h-11 shrink-0" aria-label="Изпрати">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
            {info && <Meta>Този месец: {info.spent} от {info.cap}. Отговорите може да грешат: проверете важното в Prody.</Meta>}
          </div>
        </section>
      </div>
    </div>
  )
}
