/**
 * One question to the assistant: the loop between the model and the read-only tools.
 *
 * The model answers or asks for tools; we run the tools (all at once when it
 * asks for several), hand back the results and ask again, until it answers.
 * The messages are kept exactly as the API returned them, including the
 * model's reasoning, because DeepSeek's thinking mode must get it back on the
 * next call, and the next question in the conversation sends them all again.
 */
import { ASSISTANT_MODEL, type TokenUsage } from './pricing'
import { runTool, toolDefinitions, toolStatus, type ToolContext } from './tools'
import { systemPrompt } from './prompt'
import type { ChatMessage, ChatRequest, ChatResponse } from './deepseek'

/** At most this many calls to the model per question; the last one must answer. */
export const MAX_ROUNDS = 10

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'answer'; text: string }

/** One stored row: the chat messages it holds, and what the screen shows (null for steps). */
export type StoredMessage = { role: 'user' | 'assistant'; content: ChatMessage[]; display: string | null }

export type AgentResult = {
  answer: string
  /** The question, the model's turns and the tool results, in order, to store. */
  messages: StoredMessage[]
}

type AssistantMessage = Extract<ChatMessage, { role: 'assistant' }>

/** Only the fields DeepSeek reads back; anything else it returned is dropped. */
function keep(m: AssistantMessage): AssistantMessage {
  return {
    role: 'assistant',
    content: m.content ?? null,
    ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
    ...(m.tool_calls?.length ? { tool_calls: m.tool_calls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.function.name, arguments: c.function.arguments } })) } : {}),
  }
}

function parseArgs(raw: string): unknown {
  try {
    return raw?.trim() ? JSON.parse(raw) : {}
  } catch {
    return undefined
  }
}

export async function askAssistant(opts: {
  /** Earlier messages of the conversation, unchanged. */
  history: ChatMessage[]
  question: string
  ctx: ToolContext
  today: string
  userName: string
  call: (req: ChatRequest) => Promise<ChatResponse>
  onEvent: (e: AgentEvent) => void
  /** Called after every model call, with what it used (for the cost record). */
  onUsage: (model: string, usage: TokenUsage) => Promise<void>
}): Promise<AgentResult> {
  const tools = toolDefinitions()
  // The instructions go first and stay the same, so DeepSeek's prefix cache holds.
  const system: ChatMessage = { role: 'system', content: systemPrompt(opts.today, opts.userName) }
  const added: StoredMessage[] = [{ role: 'user', content: [{ role: 'user', content: opts.question }], display: opts.question }]
  const messages = (): ChatMessage[] => [system, ...opts.history, ...added.flatMap(m => m.content)]

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1
    const res = await opts.call({
      model: ASSISTANT_MODEL,
      messages: messages(),
      tools,
      // On the last round the model may not call tools any more: it answers with what it has.
      tool_choice: last ? 'none' : 'auto',
      max_tokens: 32000,
    })
    await opts.onUsage(res.model || ASSISTANT_MODEL, res.usage || {})

    const choice = res.choices?.[0]
    if (!choice) throw new Error('DeepSeek returned no answer')
    const message = keep(choice.message)
    const calls = message.tool_calls || []

    if (calls.length && !last) {
      added.push({ role: 'assistant', content: [message], display: null })
      for (const c of calls) opts.onEvent({ type: 'status', text: toolStatus(c.function.name) })
      const results: ChatMessage[] = await Promise.all(calls.map(async c => {
        const input = parseArgs(c.function.arguments)
        const r = input === undefined
          ? { text: JSON.stringify({ error: 'Аргументите не са валиден JSON. Опитай пак.' }) }
          : await runTool(opts.ctx, c.function.name, input)
        return { role: 'tool' as const, tool_call_id: c.id, content: r.text }
      }))
      added.push({ role: 'user', content: results, display: null })
      continue
    }

    let answer = (message.content || '').trim()
    if (choice.finish_reason === 'content_filter') answer = answer || 'На този въпрос не мога да отговоря.'
    if (choice.finish_reason === 'length') answer = (answer ? answer + '\n\n' : '') + '(Отговорът стана твърде дълъг и е прекъснат. Задайте по-тесен въпрос.)'
    if (!answer) answer = 'Нямам отговор на това.'
    // A stored answer never carries tool calls: nothing would answer them.
    const stored: AssistantMessage = { role: 'assistant', content: answer }
    if (message.reasoning_content) stored.reasoning_content = message.reasoning_content
    added.push({ role: 'assistant', content: [stored], display: answer })
    opts.onEvent({ type: 'answer', text: answer })
    return { answer, messages: added }
  }

  // Not reached: the last round always answers. Kept so the type is complete.
  const answer = 'Не успях да стигна до отговор. Опитайте с по-конкретен въпрос.'
  added.push({ role: 'assistant', content: [{ role: 'assistant', content: answer }], display: answer })
  return { answer, messages: added }
}
