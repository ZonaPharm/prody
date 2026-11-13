/**
 * The call to DeepSeek's chat-completions API (OpenAI-style), with the key the
 * product-description rewrite already uses (DEEPSEEK_API_KEY).
 *
 * Note: DeepSeek keeps the data it receives in China. Владимир chose it on
 * 2026-11-13 knowing that the assistant sends sales figures and staff names.
 */
import type { TokenUsage } from './pricing'

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

/** One message in the chat-completions format, stored and sent back unchanged. */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ChatTool = { type: 'function'; function: { name: string; description: string; parameters: unknown } }

export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  tools: ChatTool[]
  tool_choice?: 'auto' | 'none'
  max_tokens?: number
}

export type ChatResponse = {
  model: string
  choices: { finish_reason: string | null; message: Extract<ChatMessage, { role: 'assistant' }> }[]
  usage?: TokenUsage
}

export class DeepSeekError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const URL = 'https://api.deepseek.com/chat/completions'

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY
}

export async function callDeepSeek(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ ...req, stream: false }),
    // One step must not hold the whole question: the route may run 300 s in total.
    signal: AbortSignal.timeout(150_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = body
    try { msg = JSON.parse(body)?.error?.message || body } catch { /* plain text */ }
    throw new DeepSeekError(res.status, msg.slice(0, 300))
  }
  return res.json()
}

/** A message for the person when DeepSeek fails. */
export function deepseekErrorText(err: unknown): string {
  if (err instanceof DeepSeekError) {
    if (err.status === 401) return 'Ключът за DeepSeek не е валиден. Администратор трябва да го смени във Vercel (DEEPSEEK_API_KEY).'
    if (err.status === 402) return 'Сметката в DeepSeek няма пари. Заредете я в platform.deepseek.com.'
    if (err.status === 429) return 'Твърде много въпроси наведнъж. Опитайте пак след минута.'
    if (err.status === 400 && /context|length|token/i.test(err.message)) return 'Разговорът стана твърде дълъг. Започнете нов разговор.'
    return `DeepSeek върна грешка (${err.status}). Опитайте пак.`
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'DeepSeek не отговори навреме. Опитайте пак.'
  return 'Нещо се обърка. Опитайте пак.'
}
