import { describe, expect, it } from 'vitest'
import { SHEET_PRESETS, labelMetrics, layoutError, paginate, perSheet, plainText, type SheetLayout } from './sheet'

const L: SheetLayout = { cols: 3, rows: 8, width: 70, height: 37, top: 0, left: 0, gapX: 0, gapY: 0, offsetX: 0, offsetY: 0 }

describe('sheet', () => {
  it('every preset fits on A4', () => {
    for (const p of SHEET_PRESETS) expect(layoutError(p.layout), p.id).toBeNull()
  })

  it('has the Office1 sheets: 24, 40, 44 and 65 a sheet', () => {
    expect(SHEET_PRESETS.map(p => perSheet(p.layout))).toEqual([24, 40, 44, 65])
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
