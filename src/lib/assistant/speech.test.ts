import { describe, expect, it } from 'vitest'
import { bulgarianVoice, speakableText, speechChunks } from './speech'

describe('speakableText', () => {
  it('reads lists, bold and euro as speech', () => {
    const t = speakableText('**Ботев** продаде 120,50 € днес\n\n- Магнезий: 5 бр.\n- Цинк: 3 бр.')
    expect(t).toBe('Ботев продаде 120,50 евро днес. Магнезий: 5 бр. Цинк: 3 бр.')
  })
  it('turns a table into sentences and skips its line of dashes', () => {
    expect(speakableText('| Обект | Оборот |\n|---|---|\n| Ботев | 10 € |')).toBe('Обект, Оборот. Ботев, 10 евро.')
  })
  it('drops links and marks', () => {
    expect(speakableText('# Заглавие\nВиж [доставката](/deliveries/1) и https://x.bg')).toBe('Заглавие. Виж доставката и.')
  })
})

describe('speechChunks', () => {
  it('keeps sentences together while they fit', () => {
    expect(speechChunks('Едно. Две. Три.', 12)).toEqual(['Едно. Две.', 'Три.'])
  })
  it('breaks a long sentence at a space, never over the limit', () => {
    const long = 'дума '.repeat(100).trim() + '.'
    const parts = speechChunks(long, 50)
    expect(parts.every(p => p.length <= 50)).toBe(true)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })
  it('nothing to say is no pieces', () => {
    expect(speechChunks('')).toEqual([])
  })
})

describe('bulgarianVoice', () => {
  it('prefers a Bulgarian voice on the device', () => {
    const v = [{ lang: 'en-US', name: 'a' }, { lang: 'bg-BG', name: 'net', localService: false }, { lang: 'bg_BG', name: 'local', localService: true }]
    expect(bulgarianVoice(v)?.name).toBe('local')
    expect(bulgarianVoice([{ lang: 'en-US' }])).toBeNull()
  })
})
