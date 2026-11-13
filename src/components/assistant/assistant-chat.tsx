'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Camera, Loader2, MessageSquarePlus, Mic, Paperclip, Square, Sparkles, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Hint, Meta, Note, PageHeader } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { Answer } from './answer'
import { ActionCardView } from './action-card'
import type { ActionCard } from '@/lib/assistant/cards'
import { shrinkImage, useDictation, useSpeaker } from './voice'

type Msg = { role: 'user' | 'assistant'; text: string; card?: undefined } | { role: 'card'; card: ActionCard; text?: undefined }

const ACCEPT = 'image/*,.pdf,.xlsx,.xls,.csv,.ods,.txt'
/** What one request to the app may carry (Vercel takes about 4.5 MB); pictures are made smaller first. */
const MAX_FILE = 4 * 1024 * 1024
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
  const cameraRef = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  // Dictation adds to what was already typed; a dictated question is answered aloud.
  const typedRef = useRef('')
  const dictatedRef = useRef(false)
  const speaker = useSpeaker()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const dictation = useDictation(
    text => {
      dictatedRef.current = true
      setInput(typedRef.current ? `${typedRef.current} ${text}` : text)
    },
    // No dictation here: open the keyboard, which has its own microphone.
    () => textRef.current?.focus(),
  )
  const [error, setError] = useState('')
  const [info, setInfo] = useState<{ configured: boolean; blocked: string | null; spent: string; cap: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Where the next message lands, so the answer read aloud is the one marked as read.
  const countRef = useRef(0)
  useEffect(() => { countRef.current = messages.length }, [messages])

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

  async function pickFile(picked: File | null) {
    setError('')
    if (!picked) { setFile(null); return }
    setPreparing(true)
    const f = await shrinkImage(picked)
    setPreparing(false)
    if (f.size > MAX_FILE) { setError('Файлът е над 4 MB. Снимайте отново или пратете само нужните страници.'); return }
    setFile(f)
  }

  function toggleDictation() {
    if (dictation.listening) { dictation.stop(); return }
    speaker.stop()
    typedRef.current = input.trim()
    dictation.start()
  }

  async function ask(question: string) {
    const attached = file
    const q = question.trim() || (attached ? 'Разчети прикачения документ.' : '')
    if (!q || busy) return
    if (dictation.listening) dictation.stop()
    // A question asked by voice gets its answer read aloud.
    const aloud = dictatedRef.current && speaker.supported
    dictatedRef.current = false
    if (aloud) speaker.unlock()
    else speaker.stop()
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
            if (aloud) speaker.speak(`a${countRef.current}`, ev.text)
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
        intro={<span className="hidden sm:inline">Питайте за наличности, продажби, доставки и заявки. Пишете или диктувайте. Прикачете или снимайте фактура, за да подготви чернова на доставка. Нищо не се записва без Вашия бутон.</span>}
        actions={<Button variant="outline" size="sm" className="h-10 rounded-full px-4" onClick={newConversation} disabled={busy}><MessageSquarePlus />Нов разговор</Button>}
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
                <Hint>Напишете или кажете въпроса си най-долу (бутонът с микрофона), снимайте документ или изберете пример.</Hint>
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
                  'max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[80%]',
                  m.role === 'user' ? 'whitespace-pre-wrap rounded-br-md bg-slate-900 text-white' : 'rounded-bl-md border bg-slate-50 text-slate-900',
                )}>
                  {m.role === 'user' ? m.text : (
                    <>
                      <Answer text={m.text} />
                      {speaker.supported && (
                        <button
                          type="button"
                          onClick={() => (speaker.speaking === `a${i}` ? speaker.stop() : speaker.speak(`a${i}`, m.text))}
                          className="-mb-1 -ml-1.5 mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
                        >
                          {speaker.speaking === `a${i}`
                            ? <><Square className="h-3.5 w-3.5 fill-current" aria-hidden />Спри четенето</>
                            : <><Volume2 className="h-4 w-4" aria-hidden />Прочети на глас</>}
                        </button>
                      )}
                    </>
                  )}
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

          <div className="space-y-2 border-t bg-slate-50/60 p-2 sm:p-3">
            {error && <Note tone="danger" small>{error}</Note>}
            {dictation.error && <Note tone="warn" small>{dictation.error}</Note>}
            {dictation.blocked && <MicHelp onClose={dictation.clearError} />}
            {blocked && <Note tone="warn" small>{blocked}</Note>}
            {speaker.noBulgarian && (
              <Meta>На това устройство няма български глас за четене: отговорите ще се четат с акцент. Може да се добави от настройките за говор на телефона.</Meta>
            )}
            <form
              className={cn(
                'rounded-2xl border bg-white shadow-sm transition-shadow focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-100',
                dictation.listening && 'border-red-300 ring-2 ring-red-100',
              )}
              onSubmit={e => { e.preventDefault(); ask(input) }}
            >
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
                onChange={e => { pickFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { pickFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
              {(file || preparing) && (
                <div className="flex items-center gap-2 px-3 pt-3">
                  <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border bg-slate-50 py-1 pl-3 pr-1 text-xs">
                    {preparing ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-hidden />
                      : file?.type.startsWith('image/') ? <Camera className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                      : <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />}
                    <span className="min-w-0 truncate">{preparing ? 'Подготвям снимката…' : file?.name}</span>
                    {file && (
                      <button type="button" onClick={() => setFile(null)} aria-label="Махни файла"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              )}
              <Textarea
                ref={textRef}
                value={input}
                onChange={e => { setInput(e.target.value); if (!e.target.value) dictatedRef.current = false }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input) }
                }}
                placeholder={dictation.asking ? 'Разрешете микрофона в прозореца горе…' : dictation.listening ? 'Слушам… говорете' : 'Въпрос към асистента…'}
                rows={2}
                maxLength={4000}
                disabled={busy || !!blocked}
                className="min-h-[3.25rem] resize-none border-0 bg-transparent px-3.5 pt-3 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <Button type="button" variant="ghost" size="sm" className="h-10 rounded-full px-3 text-slate-700" disabled={busy || preparing || !!blocked}
                  onClick={() => fileRef.current?.click()} title="Прикачи снимка, PDF или Excel">
                  <Paperclip />Файл
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-10 rounded-full px-3 text-slate-700" disabled={busy || preparing || !!blocked}
                  onClick={() => cameraRef.current?.click()} title="Снимайте хартиен документ с камерата">
                  <Camera />Снимка
                </Button>
                <div className="flex-1" />
                {dictation.listening && <span className="mr-1 hidden animate-pulse text-xs font-medium text-red-600 sm:inline">Слушам…</span>}
                <Button type="button" variant={dictation.listening ? 'destructive' : 'outline'} size="icon"
                  className={cn('h-10 w-10 rounded-full', dictation.listening && 'animate-pulse')}
                  disabled={busy || dictation.asking || !!blocked} onClick={toggleDictation}
                  aria-label={dictation.listening ? 'Спри диктуването' : 'Диктувай с глас'} title={dictation.listening ? 'Спри диктуването' : 'Диктувай с глас (български)'}
                  aria-pressed={dictation.listening}>
                  {dictation.listening ? <Square className="fill-current" /> : <Mic />}
                </Button>
                <Button type="submit" size="icon" className="h-10 w-10 rounded-full"
                  disabled={busy || preparing || (!input.trim() && !file) || !!blocked} aria-label="Изпрати" title="Изпрати">
                  {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </Button>
              </div>
            </form>
            {info && <Meta>Този месец: {info.spent} от {info.cap}. Отговорите може да грешат: проверете важното в Prody.</Meta>}
          </div>
        </section>
      </div>
    </div>
  )
}

/** How to allow the microphone once the browser has refused it for this site (it will not ask again). */
function MicHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">Микрофонът е забранен за Prody в този браузър</p>
        <button type="button" onClick={onClose} aria-label="Затвори" className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-amber-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1">Браузърът вече не пита. Разрешете го веднъж така:</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>Натиснете иконата вляво от адреса горе (катинарче или <span aria-hidden>⚙</span>).</li>
        <li>„Разрешения“ → „Микрофон“ → „Разрешаване“.</li>
        <li>Презаредете страницата и натиснете микрофона пак.</li>
      </ol>
      <p className="mt-1.5 text-xs">Ако иконата я няма: в Chrome ⋮ → Настройки → Настройки на сайта → Микрофон → изберете сайта → Разрешаване. Ако Prody е отворен от линк в друго приложение, първо ⋮ → „Отваряне в Chrome“.</p>
      <p className="mt-1.5 text-xs">Дотогава може да диктувате с микрофона на клавиатурата.</p>
    </div>
  )
}
