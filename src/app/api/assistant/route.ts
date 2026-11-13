import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { sofiaToday } from '@/lib/date-utils'
import { assistantAccess, assistantConfigured } from '@/lib/assistant/access'
import { askAssistant, type AgentEvent } from '@/lib/assistant/agent'
import { namesLoader } from '@/lib/assistant/tools'
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
    blocked: capState.ok ? null : capState.message,
    spent: formatUsd(spend.total),
    cap: formatUsd(cap),
  })
}

const Body = z.object({
  conversation_id: z.string().uuid().nullish(),
  question: z.string().trim().min(1, 'Напишете въпрос').max(4000, 'Въпросът е твърде дълъг'),
})

/**
 * Asks one question. The answer comes back as a stream of JSON lines:
 * {"type":"conversation"} first, then {"type":"status"} while tools run, then
 * {"type":"answer"} and {"type":"done"}, or {"type":"error"}.
 */
export async function POST(request: NextRequest) {
  const access = await assistantAccess()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!assistantConfigured()) {
    return NextResponse.json({ error: 'AI асистентът още не е настроен (липсва ключ DEEPSEEK_API_KEY във Vercel).' }, { status: 503 })
  }
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Грешна заявка' }, { status: 400 })
  const { question } = parsed.data
  const user = access.user
  const db = createAdminClient()

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
        const result = await askAssistant({
          history: history.history,
          question,
          ctx: { db, names: namesLoader(db) },
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
