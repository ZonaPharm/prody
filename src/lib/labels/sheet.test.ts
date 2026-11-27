import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, SHEET_PRESETS, correctSpread, labelMetrics, layoutError, paginate, perSheet, plainText, type SheetLayout } from './sheet'

const L: SheetLayout = { cols: 3, rows: 8, width: 70, height: 37, top: 0, left: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0 }

describe('sheet', () => {
  it('every preset fits on A4', () => {
    for (const p of SHEET_PRESETS) expect(layoutError(p.layout), p.id).toBeNull()
  })

  it('has the Office1 sheets: 21, 24, 40, 44 and 65 a sheet; 24 stays the default', () => {
    expect(SHEET_PRESETS.map(p => perSheet(p.layout))).toEqual([21, 24, 40, 44, 65])
    expect(perSheet(DEFAULT_LAYOUT)).toBe(24)
  })

  it('every preset from the maker numbers is centred on A4 (65 a sheet is measured, see below)', () => {
    for (const { id, layout: l } of SHEET_PRESETS.filter(p => p.id !== '5x13')) {
      const right = 210 - (l.left + l.cols * l.width + (l.cols - 1) * l.gapX)
      expect(Math.abs(right - l.left), id).toBeLessThan(0.11)
      const bottom = 297 - (l.top + l.rows * l.height + (l.rows - 1) * l.gapY)
      expect(Math.abs(bottom - l.top), id).toBeLessThan(0.11)
    }
  })

  it('21 a sheet is Top Stick 63.5 × 38.1 mm: 3 × 7, step 66 mm across and 38.1 mm down', () => {
    const l = SHEET_PRESETS.find(p => p.id === '3x7')!.layout
    expect(l).toMatchObject({ cols: 3, rows: 7, width: 63.5, height: 38.1, gapY: 0 })
    expect(l.width + l.gapX).toBeCloseTo(66, 5)
    expect(l.top).toBeCloseTo(15.15, 5)
    expect(l.left).toBeCloseTo(7.25, 5)
  })

  it('65 a sheet is the Office1 paper as measured: 38 mm step, no gap, first label 9 mm from the left', () => {
    const l = SHEET_PRESETS.find(p => p.id === '5x13')!.layout
    expect(l).toMatchObject({ cols: 5, rows: 13, width: 38, height: 21.2, top: 10.7, left: 9, gapX: 0, gapY: 0 })
    const lefts = Array.from({ length: l.cols }, (_, c) => l.left + c * (l.width + l.gapX))
    expect(lefts).toEqual([9, 47, 85, 123, 161])
  })

  describe('correctSpread', () => {
    // A 65 sheet with a 2.5 mm gap between the columns (Avery L7651), as it was before.
    const p65: SheetLayout = { cols: 5, rows: 13, width: 38.1, height: 21.2, top: 10.7, left: 4.75, gapX: 2.5, gapY: 0, offsetX: 0, offsetY: 0 }
    const xOf = (l: SheetLayout, c: number) => l.left + c * (l.width + l.gapX) + l.width / 2
    const yOf = (l: SheetLayout, r: number) => l.top + r * (l.height + l.gapY) + l.height / 2

    it('65 a sheet, outer columns 1 mm outward: smaller gap, middle column stays put', () => {
      const f = correctSpread(p65, 1, 0)
      expect(f.gapX).toBeCloseTo(2, 5)
      expect(f.left).toBeCloseTo(5.75, 5)
      expect(f.width).toBe(p65.width)
      expect(xOf(f, 2)).toBeCloseTo(xOf(p65, 2), 5)
      expect(xOf(f, 0)).toBeCloseTo(xOf(p65, 0) + 1, 5)
      expect(xOf(f, 4)).toBeCloseTo(xOf(p65, 4) - 1, 5)
      expect(f.top).toBe(p65.top)
      expect(f.rows).toBe(p65.rows)
      expect(layoutError(f)).toBeNull()
    })

    it('inward drift widens the gap', () => {
      const f = correctSpread(p65, -0.5, 0)
      expect(f.gapX).toBeCloseTo(2.75, 5)
      expect(xOf(f, 0)).toBeCloseTo(xOf(p65, 0) - 0.5, 5)
      expect(layoutError(f)).toBeNull()
    })

    it('without a gap the label gets narrower, keeping its middle in place', () => {
      const f = correctSpread(DEFAULT_LAYOUT, 0.5, 0) // 24 a sheet: 3 × 70 mm, no gap
      expect(f.gapX).toBe(0)
      expect(f.width).toBeCloseTo(69.5, 5)
      expect(xOf(f, 1)).toBeCloseTo(xOf(DEFAULT_LAYOUT, 1), 5)
      expect(xOf(f, 2)).toBeCloseTo(xOf(DEFAULT_LAYOUT, 2) - 0.5, 5)
    })

    it('rows: 21 a sheet, top and bottom rows 1.5 mm outward', () => {
      const p21 = SHEET_PRESETS.find(p => p.id === '3x7')!.layout
      const f = correctSpread(p21, 0, 1.5)
      expect(yOf(f, 3)).toBeCloseTo(yOf(p21, 3), 5)
      expect(yOf(f, 0)).toBeCloseTo(yOf(p21, 0) + 1.5, 5)
      expect(yOf(f, 6)).toBeCloseTo(yOf(p21, 6) - 1.5, 5)
      expect(f.left).toBe(p21.left)
    })

    it('does nothing for 0, a single column, or no number', () => {
      expect(correctSpread(p65, 0, 0)).toEqual(p65)
      expect(correctSpread({ ...p65, cols: 1 }, 2, 0)).toEqual({ ...p65, cols: 1 })
      expect(correctSpread(p65, NaN, 0)).toEqual(p65)
    })

    it('a fix too big shows up in layoutError', () => {
      expect(layoutError(correctSpread(p65, -20, 0))).not.toBeNull()
    })
  })

  it('sizes the label text: smaller on small labels, never below the floor', () => {
    const big = labelMetrics(70, 37, true)
    const small = labelMetrics(38.1, 21.2, true)
    expect(big.namePt).toBe(9)
    expect(big.codePt).toBeGreaterThan(0)
    expect(big.descLines).toBeGreaterThanOrEqual(3)
    expect(small.namePt).toBe(6)
    expect(small.pricePt).toBe(7)
    expect(small.codePt).toBe(0)
    expect(small.descLines).toBeGreaterThanOrEqual(1)
    const noCode = labelMetrics(38.1, 21.2, false)
    expect(noCode.barH).toBe(0)
    expect(noCode.descLines).toBeGreaterThan(small.descLines)
    expect(labelMetrics(20, 10, true).descLines).toBe(0)
  })

  it('counts the labels on a sheet', () => {
    expect(perSheet(L)).toBe(24)
    expect(perSheet({ ...L, cols: 2, rows: 7 })).toBe(14)
  })

  it('says when the labels do not fit', () => {
    expect(layoutError({ ...L, cols: 4 })).toMatch(/ширина/)
    expect(layoutError({ ...L, rows: 9 })).toMatch(/височина/)
    expect(layoutError({ ...L, cols: 1.5 })).toMatch(/цели числа/)
    expect(layoutError({ ...L, width: -1 })).toMatch(/0 или повече/)
    expect(layoutError({ ...L, width: 10 })).toMatch(/по-малък/)
    expect(layoutError({ ...L, offsetY: -2.5 })).toBeNull()
    expect(layoutError({ ...L, offsetX: 21 })).toMatch(/Отместването/)
  })

  it('fills pages and pads the last one', () => {
    const pages = paginate(Array.from({ length: 30 }, (_, i) => i), L)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(24)
    expect(pages[1].filter(x => x !== null)).toEqual([24, 25, 26, 27, 28, 29])
    expect(pages[1]).toHaveLength(24)
  })

  it('starts after the cells already used', () => {
    const pages = paginate([1, 2, 3], L, 23)
    expect(pages).toHaveLength(2)
    expect(pages[0].slice(0, 22).every(x => x === null)).toBe(true)
    expect(pages[0].slice(22)).toEqual([1, 2])
    expect(pages[1][0]).toBe(3)
    expect(paginate([1], L, 999)[0][23]).toBe(1)
    expect(paginate([1], L, 0)[0][0]).toBe(1)
  })

  it('no labels, no pages', () => {
    expect(paginate([], L)).toEqual([])
  })

  it('turns product HTML into plain text', () => {
    expect(plainText('<p>Крем за лице<br/>50&nbsp;мл</p><ul><li>SPF&amp;UV</li></ul>')).toBe('Крем за лице 50 мл SPF&UV')
    expect(plainText(null)).toBe('')
  })
})
