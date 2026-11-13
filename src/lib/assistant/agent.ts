/**
 * One question to the assistant: the loop between Claude and the read-only tools.
 *
 * Claude answers or asks for tools; we run the tools (all at once when it asks
 * for several), hand back the results and ask again, until it answers. The
 * messages are kept exactly as the API returned them, because the next question
 * in the conversation sends them back unchanged.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessage, BetaMessageParam, BetaContentBlockParam, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ASSISTANT_MODEL } from './pricing'
import { runTool, toolDefinitions, toolStatus, type ToolContext } from './tools'
import { systemPrompt } from './prompt'

/** At most this many calls to the model per question; the last one must answer. */
export const MAX_ROUNDS = 10

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'answer'; text: string }

export type StoredMessage = { role: 'user' | 'assistant'; content: BetaContentBlockParam[]; display: string | null }

export type AgentResult = {
  answer: string
  /** The question, the model's turns and the tool results, in order, to store. */
  messages: StoredMessage[]
}

type ModelCall = (params: Parameters<Anthropic['beta']['messages']['create']>[0]) => Promise<BetaMessage>

export function textOf(content: ReadonlyArray<{ type: string }>): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
    .trim()
}

export async function askAssistant(opts: {
  /** Earlier messages of the conversation, unchanged. */
  history: BetaMessageParam[]
  question: string
  ctx: ToolContext
  today: string
  userName: string
  call: ModelCall
  onEvent: (e: AgentEvent) => void
  /** Called after every model call, with what it used (for the cost record). */
  onUsage: (model: string, usage: BetaMessage['usage']) => Promise<void>
}): Promise<AgentResult> {
  const tools = toolDefinitions()
  const system = systemPrompt(opts.today, opts.userName)
  const added: StoredMessage[] = [{ role: 'user', content: [{ type: 'text', text: opts.question }], display: opts.question }]
  const messages = (): BetaMessageParam[] => [...opts.history, ...added.map(m => ({ role: m.role, content: m.content }))]

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1
    const res = await opts.call({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      system,
      tools,
      // On the last round the model may not call tools any more: it answers with what it has.
      ...(last ? { tool_choice: { type: 'none' as const } } : {}),
      messages: messages(),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      // Caches the stable start (instructions, tools, earlier turns) between calls.
      cache_control: { type: 'ephemeral' },
      // If the model declines for a safety reason, the API retries on another model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as any)
    await opts.onUsage(res.model || ASSISTANT_MODEL, res.usage)

    const content = res.content as unknown as BetaContentBlockParam[]

    if (res.stop_reason === 'tool_use') {
      added.push({ role: 'assistant', content, display: null })
      const calls = res.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
      for (const c of calls) opts.onEvent({ type: 'status', text: toolStatus(c.name) })
      const results: BetaToolResultBlockParam[] = await Promise.all(calls.map(async c => {
        const r = await runTool(opts.ctx, c.name, c.input)
        return { type: 'tool_result' as const, tool_use_id: c.id, content: r.text, ...(r.isError ? { is_error: true } : {}) }
      }))
      added.push({ role: 'user', content: results, display: null })
      continue
    }

    if (res.stop_reason === 'pause_turn') {
      added.push({ role: 'assistant', content, display: null })
      continue
    }

    let answer = textOf(res.content)
    if (res.stop_reason === 'refusal') answer = answer || 'На този въпрос не мога да отговоря.'
    if (res.stop_reason === 'max_tokens') answer = (answer ? answer + '\n\n' : '') + '(Отговорът стана твърде дълъг и е прекъснат. Задайте по-тесен въпрос.)'
    if (!answer) answer = 'Нямам отговор на това.'
    added.push({ role: 'assistant', content, display: answer })
    opts.onEvent({ type: 'answer', text: answer })
    return { answer, messages: added }
  }

  // Not reached: the last round cannot call tools. Kept so the type is complete.
  const answer = 'Не успях да стигна до отговор. Опитайте с по-конкретен въпрос.'
  added.push({ role: 'assistant', content: [{ type: 'text', text: answer }], display: answer })
  return { answer, messages: added }
}
