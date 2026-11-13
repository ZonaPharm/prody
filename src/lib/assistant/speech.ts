/**
 * Reading the assistant's answer aloud: the text a voice should say, in pieces
 * short enough for the browser (Chrome stops a long piece after about 15 s).
 * Pure functions, used in the browser by components/assistant/voice.ts.
 */
import { parseAnswer } from './answer-format'

/** The answer as plain sentences: no list marks, bold marks or table lines; € said as "евро". */
export function speakableText(answer: string): string {
  const parts: string[] = []
  for (const b of parseAnswer(answer)) {
    const lines = b.kind === 'ul' ? b.items : b.lines
    for (const l of lines) {
      let t = l.map(s => s.text).join('').trim()
      if (/^\|?\s*:?-{2,}/.test(t)) continue // a table's |---|---| line
      t = t.replace(/^\||\|$/g, '').replace(/\s*\|\s*/g, ', ')
      t = t.replace(/[`*_#>]+/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
      t = t.replace(/(\d)\s*€/g, '$1 евро').replace(/€\s*(\d[\d\s.,]*)/g, '$1 евро').replace(/€/g, 'евро')
      t = t.replace(/\s+/g, ' ').trim()
      if (!t) continue
      parts.push(/[.!?:;…]$/.test(t) ? t : `${t}.`)
    }
  }
  return parts.join(' ')
}

/** Splits text at sentence ends (or commas, or spaces) into pieces of at most `max` characters. */
export function speechChunks(text: string, max = 180): string[] {
  const out: string[] = []
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? []
  let cur = ''
  const push = (s: string) => { const t = s.trim(); if (t) out.push(t) }
  for (const s of sentences) {
    if ((cur + s).length <= max) { cur += s; continue }
    push(cur)
    cur = ''
    let rest = s
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max))
      const at = cut > max / 3 ? cut + 1 : max
      push(rest.slice(0, at))
      rest = rest.slice(at)
    }
    cur = rest
  }
  push(cur)
  return out
}

/** The best voice for Bulgarian, if the device has one. */
export function bulgarianVoice<V extends { lang: string; localService?: boolean; default?: boolean }>(voices: V[]): V | null {
  const bg = voices.filter(v => v.lang?.toLowerCase().replace('_', '-').startsWith('bg'))
  return bg.find(v => v.localService) ?? bg[0] ?? null
}
