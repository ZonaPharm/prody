import { transcriptionConfigured } from '@/lib/assistant/transcribe'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { sofiaToday } from '@/lib/date-utils'
import { assistantAccess, assistantConfigured } from '@/lib/assistant/access'
import { askAssistant, type AgentEvent } from '@/lib/assistant/agent'
import { namesLoader, type ActContext } from '@/lib/assistant/tools'
import { AttachmentError, documentBlock, readAttachment, type Attachment } from '@/lib/assistant/attachments'
import type { UserPart } from '@/lib/assistant/deepseek'
import { deliveriesEnabledFor } from '@/lib/deliveries/feature'
import { callDeepSeek, deepseekErrorText } from '@/lib/assistant/deepseek'
import { checkCap, formatUsd } from '@/lib/assistant/pricing'
import {
  MAX_QUESTIONS_PER_CONVERSATION, createConversation, listConversations, loadHistory,
  monthSpend, monthlyCap, ownConversation, recordUsage, saveMessages,
} from '@/lib/assistant/store'

// A question can take several rounds of checks.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

/** The person's conversations and whether the assistant can answer now. */
export async function GET() {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const db = createAdminClient()
  const [conversations, spend, cap] = await Promise.all([
    listConversations(db, access.user.id), monthSpend(db), monthlyCap(db),
  ])
  const capState = checkCap(spend.total, cap)
  return NextResponse.json({
    conversations,
    configured: assistantConfigured(),
    // Speech to text on the server (ElevenLabs); otherwise the browser's own recognition.
    voice: transcriptionConfigured(),
    blocked: capState.ok ? null : capState.message,
    spent: formatUsd(spend.total),
    cap: formatUsd(cap),
  })
}

const Body = z.object({
  conversation_id: z.string().uuid().nullish(),
  question: z.string().trim().min(1, 'Напишете въпрос').max(4000, 'Въпросът е твърде дълъг'),
})

/** JSON, or a form with the question and one attached file (photo, PDF, Excel). */
async function readRequest(request: NextRequest): Promise<{ body: unknown; file: File | null }> {
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    if (!form) return { body: null, file: null }
    const file = form.get('file')
    return {
      body: { conversation_id: form.get('conversation_id') || null, question: form.get('question') || '' },
      file: file instanceof File && file.size > 0 ? file : null,
    }
  }
  return { body: await request.json().catch(() => null), file: null }
}

/** The question as the model gets it now (with the picture), and as it is kept. */
function questionContent(question: string, a: Attachment): { now: string | UserPart[]; stored: string } {
  const text = question + documentBlock(a)
  if (a.kind === 'image') {
    return {
      now: [{ type: 'text', text }, { type: 'image_url', image_url: { url: a.dataUrl } }],
      stored: text + '\n[Снимката не се пази: каквото е разчетено от нея, е в отговорите по-долу.]',
    }
  }
  return { now: text, stored: text }
}

/**
 * Asks one question. The answer comes back as a stream of JSON lines:
 * {"type":"conversation"} first, then {"type":"status"} while tools run, then
 * {"type":"card"} for each proposal or file, {"type":"answer"} and {"type":"done"},
 * or {"type":"error"}.
 */
export async function POST(request: NextRequest) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!assistantConfigured()) {
    return NextResponse.json({ error: 'AI асистентът още не е настроен (липсва ключ DEEPSEEK_API_KEY във Vercel).' }, { status: 503 })
  }
  const req = await readRequest(request)
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Грешна заявка' }, { status: 400 })
  const { question } = parsed.data
  const user = access.user
  const db = createAdminClient()

  // An attached document is read before anything is stored, so a bad file costs nothing.
  let attachment: Attachment | null = null
  if (req.file) {
    try {
      attachment = await readAttachment(req.file.name, req.file.type, new Uint8Array(await req.file.arrayBuffer()))
    } catch (err) {
      if (err instanceof AttachmentError) return NextResponse.json({ error: err.message }, { status: 400 })
      throw err
    }
  }
  const shown = attachment ? `${question}\n📎 ${attachment.name}` : question

  const [spend, cap] = await Promise.all([monthSpend(db), monthlyCap(db)])
  const capState = checkCap(spend.total, cap)
  if (!capState.ok) return NextResponse.json({ error: capState.message }, { status: 429 })

  let conversation: { id: string; title: string }
  let history: Awaited<ReturnType<typeof loadHistory>> = { history: [], nextSeq: 1, questions: 0 }
  if (parsed.data.conversation_id) {
    const own = await ownConversation(db, user.id, parsed.data.conversation_id)
    if (!own) return NextResponse.json({ error: 'Няма такъв разговор.' }, { status: 404 })
    conversation = { id: own.id, title: own.title }
    history = await loadHistory(db, own.id)
    if (history.questions >= MAX_QUESTIONS_PER_CONVERSATION) {
      return NextResponse.json({ error: `Този разговор стигна ${MAX_QUESTIONS_PER_CONVERSATION} въпроса. Започнете нов разговор.` }, { status: 400 })
    }
  } else {
    conversation = await createConversation(db, user.id, question)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      send({ type: 'conversation', id: conversation.id, title: conversation.title })
      try {
        const act: ActContext = {
          userId: user.id,
          userName: user.name,
          conversationId: conversation.id,
          questionSeq: history.nextSeq,
          deliveries: deliveriesEnabledFor(user.email),
          emit: card => send({ type: 'card', card }),
        }
        const result = await askAssistant({
          history: history.history,
          question: shown,
          content: attachment ? questionContent(question, attachment) : undefined,
          ctx: { db, names: namesLoader(db), act },
          today: sofiaToday(),
          userName: user.name,
          call: callDeepSeek,
          onEvent: (e: AgentEvent) => send(e),
          onUsage: (model, usage) => recordUsage(db, { userId: user.id, conversationId: conversation.id, model, usage }),
        })
        await saveMessages(db, conversation.id, history.nextSeq, result.messages)
        send({ type: 'done' })
      } catch (err) {
        console.error('assistant failed:', err)
        send({ type: 'error', text: deepseekErrorText(err) })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
