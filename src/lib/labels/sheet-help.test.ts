import { describe, expect, it } from 'vitest'
import { CALIBRATION_STEPS, SHEET_HELP, type HelpKey } from './sheet-help'

const KEYS: HelpKey[] = [
  'profile', 'cols', 'rows', 'width', 'height', 'top', 'left', 'gapX', 'gapY',
  'offsetX', 'offsetY', 'spreadX', 'spreadY', 'testSheet', 'start', 'outline',
]

describe('sheet help', () => {
  it('every setting on the print screen has a title, an explanation and an example', () => {
    expect(Object.keys(SHEET_HELP).sort()).toEqual([...KEYS].sort())
    for (const k of KEYS) {
      const h = SHEET_HELP[k]
      expect(h.title.trim(), k).not.toBe('')
      expect(h.text.length, k).toBeGreaterThan(20)
      expect(h.example.length, k).toBeGreaterThan(20)
    }
  })

  it('the examples give real numbers to copy (the outline on/off has none)', () => {
    for (const k of KEYS.filter(k => k !== 'outline')) expect(SHEET_HELP[k].example, k).toMatch(/\d/)
  })

  it('the spread fix explains the case from the 65 sheet: middle right, outer columns 1 mm out', () => {
    expect(SHEET_HELP.spreadX.text).toMatch(/средната колона/)
    expect(SHEET_HELP.spreadX.example).toMatch(/Пиши 1/)
    expect(SHEET_HELP.offsetX.example).toMatch(/−1/)
  })

  it('the steps start from a test sheet and end with a saved profile', () => {
    expect(CALIBRATION_STEPS[0]).toMatch(/Пробен лист/)
    expect(CALIBRATION_STEPS.at(-1)).toMatch(/профил/)
  })
})
