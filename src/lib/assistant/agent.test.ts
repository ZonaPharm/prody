import { describe, expect, it } from 'vitest'
import { askAssistant, MAX_ROUNDS, type AgentEvent } from './agent'
import { namesLoader } from './tools'
import { fakeDb } from './fake-db'

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const msg = (stop: string, content: any[], model = 'claude-opus-5-5') => ({ id: 'm', type: 'message', role: 'assistant', model, stop_reason: stop, content, usage }) as any

function setup(replies: any[]) {
  const f = fakeDb(q => (q.table === 'stores' ? [{ id: 's', name: 'Ботев', is_active: true }] : []))
  const calls: any[] = []
  const events: AgentEvent[] = []
  const usages: string[] = []
  const run = (history: any[] = []) => askAssistant({
    history,
    question: 'Кои са обектите?',
    ctx: { db: f.db, names: namesLoader(f.db) },
    today: '2026-11-13',
    userName: 'Мира',
    call: async p => { calls.push(JSON.parse(JSON.stringify(p))); return replies.shift() ?? msg('tool_use', [{ type: 'tool_use', id: 't', name: 'people_and_stores', input: {} }]) },
    onEvent: e => events.push(e),
    onUsage: async model => { usages.push(model) },
  })
  return { run, calls, events, usages }
}

describe('askAssistant', () => {
  it('runs the tools the model asks for and returns its answer', async () => {
    const { run, calls, events, usages } = setup([
      msg('tool_use', [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 't1', name: 'people_and_stores', input: {} },
      ]),
      msg('end_turn', [{ type: 'text', text: 'Има един обект: **Ботев**.' }]),
    ])
    const r = await run()
    expect(r.answer).toBe('Има един обект: **Ботев**.')
    expect(events).toEqual([{ type: 'status', text: 'Гледам обектите и хората…' }, { type: 'answer', text: 'Има един обект: **Ботев**.' }])
    expect(usages).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
    // Stored in order: question, tool call (thinking kept as is), tool result, answer.
    expect(r.messages.map(m => [m.role, m.display])).toEqual([
      ['user', 'Кои са обектите?'], ['assistant', null], ['user', null], ['assistant', 'Има един обект: **Ботев**.'],
    ])
    expect(r.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig' })
    const result = r.messages[2].content[0] as any
    expect(result.type).toBe('tool_result')
    expect(result.tool_use_id).toBe('t1')
    expect(JSON.parse(result.content).stores[0].name).toBe('Ботев')
    // The second call sends the whole exchange back.
    expect(calls[1].messages).toHaveLength(3)
    expect(calls[0].model).toBe('claude-opus-5-5')
    expect(calls[0].output_config).toEqual({ effort: 'medium' })
    expect(calls[0].fallbacks).toBe('default')
  })

  it('sends the earlier conversation first, unchanged', async () => {
    const history = [{ role: 'user', content: [{ type: 'text', text: 'стар' }] }, { role: 'assistant', content: [{ type: 'text', text: 'отговор' }] }]
    const { run, calls } = setup([msg('end_turn', [{ type: 'text', text: 'ок' }])])
    await run(history)
    expect(calls[0].messages.slice(0, 2)).toEqual(history)
    expect(calls[0].messages[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Кои са обектите?' }] })
  })

  it('the last round may not call tools, so it always ends with an answer', async () => {
    const replies = Array.from({ length: MAX_ROUNDS - 1 }, (_, i) =>
      msg('tool_use', [{ type: 'tool_use', id: 't' + i, name: 'people_and_stores', input: {} }]))
    replies.push(msg('end_turn', [{ type: 'text', text: 'Стига проверки.' }]))
    const { run, calls } = setup(replies)
    const r = await run()
    expect(calls).toHaveLength(MAX_ROUNDS)
    expect(calls[MAX_ROUNDS - 1].tool_choice).toEqual({ type: 'none' })
    expect(calls[0].tool_choice).toBeUndefined()
    expect(r.answer).toBe('Стига проверки.')
  })

  it('a refusal or a cut-off answer still says something useful', async () => {
    const a = setup([msg('refusal', [])])
    expect((await a.run()).answer).toContain('не мога')
    const b = setup([msg('max_tokens', [{ type: 'text', text: 'Дълго…' }])])
    expect((await b.run()).answer).toContain('прекъснат')
  })
})
