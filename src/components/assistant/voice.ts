'use client'

/**
 * Voice in the assistant chat, with the browser's own speech services:
 * dictation (SpeechRecognition, Bulgarian) and reading answers aloud
 * (speechSynthesis with a Bulgarian voice when the device has one).
 * Nothing extra goes to DeepSeek: only the typed or dictated text is sent.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { bulgarianVoice, speakableText, speechChunks } from '@/lib/assistant/speech'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

const noSubscribe = () => () => {}

const DICTATION_ERRORS: Record<string, string> = {
  // Also what a browser inside another app (a link opened from Viber, Gmail…) says: it never asks.
  'not-allowed': 'Микрофонът не е разрешен за Prody.',
  'service-not-allowed': 'Браузърът не позволява диктуване тук. Диктувайте с микрофона на клавиатурата или отворете Prody в Chrome.',
  'no-speech': 'Не чух нищо. Натиснете микрофона и говорете.',
  'audio-capture': 'Не намирам микрофон.',
  network: 'Диктуването иска връзка с интернет. Опитайте пак.',
  'language-not-supported': 'Този браузър не разпознава български. Ползвайте микрофона на клавиатурата.',
}

/** Errors after which only the keyboard's own dictation is left. */
const USE_KEYBOARD = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported'])

/**
 * Press to dictate: the words appear as they are recognised. `onText` gets
 * everything said since the button was pressed.
 */
export function useDictation(onText: (text: string) => void, onUnavailable?: () => void) {
  const supported = useSyncExternalStore(noSubscribe, () => !!recognitionClass(), () => false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  // The microphone is refused for this site: the screen shows how to allow it.
  const [blocked, setBlocked] = useState(false)
  // Waiting for the person to answer the browser's "Allow microphone?" window.
  const [asking, setAsking] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  const onUnavailableRef = useRef(onUnavailable)
  useEffect(() => { onTextRef.current = onText; onUnavailableRef.current = onUnavailable })

  const stop = useCallback(() => { rec.current?.stop() }, [])

  const start = useCallback(async () => {
    const R = recognitionClass()
    if (!R) {
      setError('Този браузър не може да диктува. Ползвайте микрофона на клавиатурата на телефона.')
      onUnavailableRef.current?.()
      return
    }
    rec.current?.abort()
    setError('')
    setBlocked(false)
    // Ask for the microphone first: this is what brings up the browser's
    // "Allow microphone?" window. Speech recognition alone often fails
    // silently instead of asking.
    if (navigator.mediaDevices?.getUserMedia) {
      setAsking(true)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(t => t.stop())
      } catch (err) {
        const name = (err as { name?: string })?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setBlocked(true)
          onUnavailableRef.current?.()
          return
        }
        if (name === 'NotFoundError') { setError(DICTATION_ERRORS['audio-capture']); return }
        // Anything else: let speech recognition try on its own.
      } finally {
        setAsking(false)
      }
    }
    const r = new R()
    r.lang = 'bg-BG'
    r.interimResults = true
    r.maxAlternatives = 1
    // Chrome on Android repeats words in continuous mode: there it stops at a pause instead.
    r.continuous = !/Android/i.test(navigator.userAgent)
    r.onresult = e => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      onTextRef.current(text.replace(/\s+/g, ' ').trim())
    }
    r.onerror = e => {
      if (e.error === 'aborted') return
      if (e.error === 'not-allowed') setBlocked(true)
      else setError(DICTATION_ERRORS[e.error] || 'Диктуването спря. Опитайте пак.')
      // Some browsers never end after an error: stop listening here, not only in onend.
      if (rec.current === r) rec.current = null
      setListening(false)
      try { r.abort() } catch { /* already stopped */ }
      if (USE_KEYBOARD.has(e.error)) onUnavailableRef.current?.()
    }
    r.onend = () => { if (rec.current === r) rec.current = null; setListening(false) }
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      rec.current = null
      setError('Диктуването не тръгна. Опитайте пак.')
    }
  }, [])

  useEffect(() => () => rec.current?.abort(), [])

  return { supported, listening, asking, blocked, error, start, stop, clearError: () => { setError(''); setBlocked(false) } }
}

function subscribeVoices(cb: () => void) {
  if (typeof speechSynthesis === 'undefined') return () => {}
  speechSynthesis.addEventListener('voiceschanged', cb)
  return () => speechSynthesis.removeEventListener('voiceschanged', cb)
}

/** Reads answers aloud; one at a time. `speaking` is the id of the one being read. */
export function useSpeaker() {
  const supported = useSyncExternalStore(noSubscribe, () => typeof speechSynthesis !== 'undefined', () => false)
  const hasBulgarian = useSyncExternalStore(
    subscribeVoices,
    () => typeof speechSynthesis !== 'undefined' && !!bulgarianVoice(speechSynthesis.getVoices()),
    () => true,
  )
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const run = useRef(0)

  const stop = useCallback(() => {
    run.current++
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    setSpeaking(null)
  }, [])

  const speak = useCallback((id: string, answer: string) => {
    if (typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const mine = ++run.current
    const chunks = speechChunks(speakableText(answer))
    if (!chunks.length) return
    const voice = bulgarianVoice(speechSynthesis.getVoices())
    chunks.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'bg-BG'
      if (voice) u.voice = voice
      const done = () => { if (run.current === mine) setSpeaking(null) }
      if (i === chunks.length - 1) u.onend = done
      u.onerror = done
      speechSynthesis.speak(u)
    })
    setSpeaking(id)
    setTried(true)
  }, [])

  /**
   * Safari reads aloud only after a tap: called on the tap that sends a
   * dictated question, so the answer can be read when it arrives.
   */
  const unlock = useCallback(() => {
    if (typeof speechSynthesis === 'undefined') return
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    speechSynthesis.speak(u)
  }, [])

  useEffect(() => () => { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel() }, [])

    // Said only once something was read: many devices have a Bulgarian voice.
  return { supported, noBulgarian: tried && !hasBulgarian, speaking, speak, stop, unlock }
}

/**
 * A phone photo is several MB; requests to the app may be at most about 4 MB.
 * A picture is made at most 2000 px on its long side (enough to read a
 * document; the server does the same) and saved as JPEG.
 */
export async function shrinkImage(file: File, max = 2000, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 1_500_000) { bmp.close(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'snimka'}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
