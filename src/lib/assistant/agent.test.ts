import { describe, expect, it } from 'vitest'
import { askAssistant, MAX_ROUNDS, type AgentEvent } from './agent'
import { namesLoader } from './tools'
import { fakeDb } from './fake-db'

const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 }
const reply = (finish: string, message: any, model = 'deepseek-flash') =>
  ({ model, choices: [{ finish_reason: finish, message: { role: 'assistant', content: null, ...message } }], usage }) as any
const toolCall = (id: string, name = 'people_and_stores', args = '{}') => ({ id, type: 'function', function: { name, arguments: args } })

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
    call: async p => { calls.push(JSON.parse(JSON.stringify(p))); return replies.shift() ?? reply('tool_calls', { tool_calls: [toolCall('t')] }) },
    onEvent: e => events.push(e),
    onUsage: async model => { usages.push(model) },
  })
  return { run, calls, events, usages }
}

describe('askAssistant', () => {
  it('runs the tools the model asks for and returns its answer', async () => {
    const { run, calls, events, usages } = setup([
      reply('tool_calls', { content: '', reasoning_content: 'Трябват ми обектите.', tool_calls: [toolCall('t1')] }),
      reply('stop', { content: 'Има един обект: **Ботев**.', reasoning_content: 'Готово.' }),
    ])
    const r = await run()
    expect(r.answer).toBe('Има един обект: **Ботев**.')
    expect(events).toEqual([{ type: 'status', text: 'Гледам обектите и хората…' }, { type: 'answer', text: 'Има един обект: **Ботев**.' }])
    expect(usages).toEqual(['deepseek-flash', 'deepseek-flash'])
    // Stored in order: question, tool call (reasoning kept), tool result, answer.
    expect(r.messages.map(m => [m.role, m.display])).toEqual([
      ['user', 'Кои са обектите?'], ['assistant', null], ['user', null], ['assistant', 'Има един обект: **Ботев**.'],
    ])
    expect(r.messages[1].content[0]).toMatchObject({ role: 'assistant', reasoning_content: 'Трябват ми обектите.', tool_calls: [{ id: 't1' }] })
    const result = r.messages[2].content[0] as any
    expect(result.role).toBe('tool')
    expect(result.tool_call_id).toBe('t1')
    expect(JSON.parse(result.content).stores[0].name).toBe('Ботев')
    // The first call: instructions, then the question, with the tools.
    expect(calls[0].model).toBe('deepseek-flash')
    expect(calls[0].messages[0].role).toBe('system')
    expect(calls[0].messages[1]).toEqual({ role: 'user', content: 'Кои са обектите?' })
    expect(calls[0].tools[0].type).toBe('function')
    // The second call sends the whole exchange back, the reasoning included (thinking mode needs it).
    expect(calls[1].messages).toHaveLength(4)
    expect(calls[1].messages[2].reasoning_content).toBe('Трябват ми обектите.')
    expect(calls[1].messages[3]).toMatchObject({ role: 'tool', tool_call_id: 't1' })
  })

  it('runs several tool calls of one step together and answers each by its id', async () => {
    const { run, calls } = setup([
      reply('tool_calls', { tool_calls: [toolCall('a'), toolCall('b', 'find_products', '{"query":"магнезий"}')] }),
      reply('stop', { content: 'ок' }),
    ])
    await run()
    expect(calls[1].messages.slice(3).map((m: any) => [m.role, m.tool_call_id])).toEqual([['tool', 'a'], ['tool', 'b']])
  })

  it('answers broken arguments with an error the model can fix', async () => {
    const { run, calls } = setup([
      reply('tool_calls', { tool_calls: [toolCall('x', 'people_and_stores', '{oops')] }),
      reply('stop', { content: 'ок' }),
    ])
    await run()
    expect(JSON.parse(calls[1].messages[3].content).error).toContain('JSON')
  })

  it('sends the earlier conversation after the instructions, unchanged', async () => {
    const history = [{ role: 'user', content: 'стар' }, { role: 'assistant', content: 'отговор', reasoning_content: 'мисля' }]
    const { run, calls } = setup([reply('stop', { content: 'ок' })])
    await run(history)
    expect(calls[0].messages.slice(1, 3)).toEqual(history)
    expect(calls[0].messages[3]).toEqual({ role: 'user', content: 'Кои са обектите?' })
  })

  it('the last round may not call tools, so it always ends with an answer', async () => {
    const replies = Array.from({ length: MAX_ROUNDS - 1 }, (_, i) => reply('tool_calls', { tool_calls: [toolCall('t' + i)] }))
    replies.push(reply('stop', { content: 'Стига проверки.' }))
    const { run, calls } = setup(replies)
    const r = await run()
    expect(calls).toHaveLength(MAX_ROUNDS)
    expect(calls[MAX_ROUNDS - 1].tool_choice).toBe('none')
    expect(calls[0].tool_choice).toBe('auto')
    expect(r.answer).toBe('Стига проверки.')
    // The stored answer has no tool calls left hanging.
    expect((r.messages[r.messages.length - 1].content[0] as any).tool_calls).toBeUndefined()
  })

  it('a filtered or cut-off answer still says something useful', async () => {
    const a = setup([reply('content_filter', { content: '' })])
    expect((await a.run()).answer).toContain('не мога')
    const b = setup([reply('length', { content: 'Дълго…' })])
    expect((await b.run()).answer).toContain('прекъснат')
  })
})
