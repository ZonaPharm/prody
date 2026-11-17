import { describe, expect, it } from 'vitest'
import { TranscribeError, audioFileName, isAudio, sttCostUsd, transcribe, transcribeErrorText } from './transcribe'

describe('transcribe', () => {
  it('sends the recording to ElevenLabs as Bulgarian and returns the text', async () => {
    let sent: { url: string; init: RequestInit } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, init }
      return new Response(JSON.stringify({ text: ' Колко  продадохме днес? ', audio_duration_secs: 3.2 }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await transcribe(new Blob(['x'], { type: 'audio/webm' }), 'audio/webm', { key: 'k', fetch: fake })
    expect(r).toEqual({ text: 'Колко продадохме днес?', seconds: 3.2 })
    expect(sent!.url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect((sent!.init.headers as Record<string, string>)['xi-api-key']).toBe('k')
    const form = sent!.init.body as FormData
    expect(form.get('language_code')).toBe('bul')
    expect(form.get('model_id')).toBeTruthy()
    expect((form.get('file') as File).name).toBe('glas.webm')
  })
  it('a refused key is said in words', async () => {
    const fake = (async () => new Response('bad', { status: 401 })) as unknown as typeof fetch
    const err = await transcribe(new Blob(['x']), 'audio/mp4', { key: 'k', fetch: fake }).catch(e => e)
    expect(err).toBeInstanceOf(TranscribeError)
    expect(transcribeErrorText(err)).toContain('ELEVENLABS_API_KEY')
  })
  it('no key, no call', async () => {
    await expect(transcribe(new Blob(['x']), 'audio/webm', { key: '' })).rejects.toBeInstanceOf(TranscribeError)
  })
})

describe('helpers', () => {
  it('knows recordings from other files', () => {
    expect(isAudio('audio/webm;codecs=opus')).toBe(true)
    expect(isAudio('audio/mp4')).toBe(true)
    expect(isAudio('video/webm')).toBe(true)
    expect(isAudio('image/png')).toBe(false)
    expect(isAudio('')).toBe(false)
  })
  it('names the file by its format (Safari records mp4)', () => {
    expect(audioFileName('audio/mp4')).toBe('glas.m4a')
    expect(audioFileName('audio/webm;codecs=opus')).toBe('glas.webm')
  })
  it('costs 0,22 $ an hour', () => {
    expect(sttCostUsd(3600)).toBeCloseTo(0.22)
    expect(sttCostUsd(10)).toBeCloseTo(0.000611, 6)
  })
})
