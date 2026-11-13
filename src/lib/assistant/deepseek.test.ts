import { afterEach, describe, expect, it, vi } from 'vitest'
import { callDeepSeek, DeepSeekError, deepseekErrorText } from './deepseek'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('callDeepSeek', () => {
  it('posts to the chat-completions endpoint with the key, not streaming', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await callDeepSeek({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'здравей' }], tools: [] })
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'deepseek-flash', stream: false })
  })
  it('turns an error reply into a DeepSeekError with its message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 })))
    const err = await callDeepSeek({ model: 'deepseek-flash', messages: [], tools: [] }).catch(e => e)
    expect(err).toBeInstanceOf(DeepSeekError)
    expect(err.status).toBe(402)
    expect(err.message).toBe('Insufficient Balance')
  })
})

describe('deepseekErrorText', () => {
  it('says what to do for the common failures', () => {
    expect(deepseekErrorText(new DeepSeekError(401, 'bad key'))).toContain('DEEPSEEK_API_KEY')
    expect(deepseekErrorText(new DeepSeekError(402, 'Insufficient Balance'))).toContain('няма пари')
    expect(deepseekErrorText(new DeepSeekError(400, 'maximum context length exceeded'))).toContain('нов разговор')
    expect(deepseekErrorText(new Error('x'))).toContain('Опитайте пак')
  })
})
