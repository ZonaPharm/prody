import { describe, expect, it } from 'vitest'
import { parseAnswer } from './answer-format'

describe('parseAnswer', () => {
  it('splits paragraphs and lists, keeps bold', () => {
    const b = parseAnswer('Оборот: **1 234,50 €**.\n\n- Ботев: 800 €\n- Офис: 434,50 €\nОстанало')
    expect(b).toEqual([
      { kind: 'p', lines: [[{ text: 'Оборот: ', bold: false }, { text: '1 234,50 €', bold: true }, { text: '.', bold: false }]] },
      { kind: 'ul', items: [[{ text: 'Ботев: 800 €', bold: false }], [{ text: 'Офис: 434,50 €', bold: false }]] },
      { kind: 'p', lines: [[{ text: 'Останало', bold: false }]] },
    ])
  })
  it('never produces markup from text', () => {
    const b = parseAnswer('<img src=x onerror=alert(1)>')
    expect(b).toEqual([{ kind: 'p', lines: [[{ text: '<img src=x onerror=alert(1)>', bold: false }]] }])
  })
})
