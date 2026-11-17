/**
 * Speech to text on the server: the recording from the microphone button goes
 * to ElevenLabs Scribe and comes back as Bulgarian text, which the person then
 * checks and sends. It works the same in every browser, unlike the browser's
 * own speech recognition (missing or tied to Siri on iPhone).
 *
 * Needs ELEVENLABS_API_KEY in Vercel; without it the browser's recognition is used.
 */

export const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v2'
/** ElevenLabs' API price for Scribe v2, per hour of audio. */
export const STT_USD_PER_HOUR = 0.22
/** One request to the app may carry about 4.5 MB; two minutes of speech is far less. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 120

export function transcriptionConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY
}

export function sttCostUsd(seconds: number): number {
  return Math.round((Math.max(0, seconds) / 3600) * STT_USD_PER_HOUR * 1e6) / 1e6
}

/** Browsers name their recordings audio/webm, audio/mp4, audio/ogg… (Chrome sometimes video/webm). */
export function isAudio(type: string): boolean {
  return /^(audio\/|video\/(webm|mp4)\b)/.test(type)
}

export function audioFileName(type: string): string {
  if (type.includes('mp4') || type.includes('aac') || type.includes('m4a')) return 'glas.m4a'
  if (type.includes('ogg')) return 'glas.ogg'
  if (type.includes('wav')) return 'glas.wav'
  if (type.includes('mpeg') || type.includes('mp3')) return 'glas.mp3'
  return 'glas.webm'
}

export class TranscribeError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function transcribeErrorText(err: unknown): string {
  if (err instanceof TranscribeError) {
    if (err.status === 401 || err.status === 403) return 'Ключът за ElevenLabs (ELEVENLABS_API_KEY) не е верен или няма право „Speech to Text“.'
    if (err.status === 402 || err.status === 429) return 'Кредитите или лимитът в ElevenLabs свършиха. Опитайте по-късно или допълнете сметката.'
    if (err.status === 422) return 'Записът не става за разчитане. Опитайте пак, малко по-дълго.'
  }
  if (err instanceof Error && err.name === 'TimeoutError') return 'Разчитането на записа отне твърде дълго. Опитайте пак.'
  return 'Не успях да превърна записа в текст. Опитайте пак.'
}

export async function transcribe(
  audio: Blob,
  type: string,
  opts: { key?: string; fetch?: typeof fetch } = {},
): Promise<{ text: string; seconds: number | null }> {
  const key = opts.key ?? process.env.ELEVENLABS_API_KEY
  if (!key) throw new TranscribeError(401, 'no key')
  const form = new FormData()
  form.set('model_id', STT_MODEL)
  form.set('language_code', 'bul')
  form.set('tag_audio_events', 'false')
  // Dictation: leave out "ъъ", repeats and false starts.
  form.set('no_verbatim', 'true')
  form.set('file', audio, audioFileName(type))
  const res = await (opts.fetch ?? fetch)(STT_URL, {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new TranscribeError(res.status, `ElevenLabs ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = await res.json() as { text?: string; audio_duration_secs?: number }
  return { text: (data.text ?? '').replace(/\s+/g, ' ').trim(), seconds: typeof data.audio_duration_secs === 'number' ? data.audio_duration_secs : null }
}
