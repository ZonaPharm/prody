/**
 * Conversations, messages, cost and the monthly cap in the database. All
 * through the service-role client: the browser never reads these tables.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/fetch-all'
import { costUsd, monthStartIso, splitUsage, type TokenUsage } from './pricing'
import type { ChatMessage } from './deepseek'
import type { StoredMessage } from './agent'

type Db = SupabaseClient<any, any, any>

/** A conversation is closed for new questions after this many, so it stays fast and cheap. */
export const MAX_QUESTIONS_PER_CONVERSATION = 30

export async function monthSpend(db: Db, now = new Date()): Promise<{ total: number; byUser: Map<string, number> }> {
  const rows = await fetchAll<any>(() => (db.from('ai_usage') as any)
    .select('user_id, cost_usd').gte('created_at', monthStartIso(now)).order('id'))
  const byUser = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    const c = Number(r.cost_usd) || 0
    total += c
    byUser.set(r.user_id, (byUser.get(r.user_id) || 0) + c)
  }
  return { total, byUser }
}

export async function monthlyCap(db: Db): Promise<number> {
  const { data, error } = await (db.from('ai_assistant_settings') as any).select('monthly_cap_usd').eq('id', 1).maybeSingle()
  if (error) throw error
  return data ? Number(data.monthly_cap_usd) : 50
}

export async function recordUsage(db: Db, row: { userId: string; conversationId: string | null; model: string; usage: TokenUsage; at?: Date }) {
  const at = row.at || new Date()
  const { hit, miss, output } = splitUsage(row.usage)
  const { error } = await (db.from('ai_usage') as any).insert({
    user_id: row.userId,
    conversation_id: row.conversationId,
    model: row.model,
    // DeepSeek has no cache writes: input is what missed the cache, cache_read what hit it.
    input_tokens: miss,
    output_tokens: output,
    cache_read_tokens: hit,
    cache_write_tokens: 0,
    cost_usd: costUsd(row.model, row.usage, at),
  })
  if (error) console.error('ai_usage insert failed:', JSON.stringify(error))
}

export function titleFrom(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim()
  return (t.length > 80 ? t.slice(0, 79) + '…' : t) || 'Нов разговор'
}

export async function listConversations(db: Db, userId: string) {
  const { data, error } = await (db.from('ai_conversations') as any)
    .select('id, title, updated_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50)
  if (error) throw error
  return data || []
}

/** The conversation, if it is this person's own. */
export async function ownConversation(db: Db, userId: string, id: string) {
  const { data, error } = await (db.from('ai_conversations') as any)
    .select('id, title, user_id').eq('id', id).maybeSingle()
  if (error) throw error
  return data && data.user_id === userId ? data : null
}

export async function createConversation(db: Db, userId: string, question: string) {
  const { data, error } = await (db.from('ai_conversations') as any)
    .insert({ user_id: userId, title: titleFrom(question) }).select('id, title').single()
  if (error) throw error
  return data as { id: string; title: string }
}

/** Every message, for sending the conversation back to the model. */
export async function loadHistory(db: Db, conversationId: string): Promise<{ history: ChatMessage[]; nextSeq: number; questions: number }> {
  const rows = await fetchAll<any>(() => (db.from('ai_messages') as any)
    .select('seq, role, content, display').eq('conversation_id', conversationId).order('seq'))
  // Each row holds one or more chat messages (a tool step holds all its results).
  const history = rows.flatMap(r => (Array.isArray(r.content) ? r.content : []) as ChatMessage[])
  const questions = rows.filter(r => r.role === 'user' && r.display != null).length
  const nextSeq = rows.length ? rows[rows.length - 1].seq + 1 : 1
  return { history, nextSeq, questions }
}

/** Only what the screen shows: the questions and the answers. */
export async function loadTranscript(db: Db, conversationId: string) {
  const rows = await fetchAll<any>(() => (db.from('ai_messages') as any)
    .select('seq, role, display, created_at').eq('conversation_id', conversationId).not('display', 'is', null).order('seq'))
  return rows.map(r => ({ role: r.role as 'user' | 'assistant', text: r.display as string, at: r.created_at as string }))
}

export async function saveMessages(db: Db, conversationId: string, firstSeq: number, messages: StoredMessage[]) {
  const { error } = await (db.from('ai_messages') as any).insert(messages.map((m, i) => ({
    conversation_id: conversationId,
    seq: firstSeq + i,
    role: m.role,
    content: m.content,
    display: m.display,
  })))
  if (error) throw error
  await (db.from('ai_conversations') as any).update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
}
