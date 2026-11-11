import { describe, expect, it } from 'vitest'
import { SHEET_PRESETS, layoutError, paginate, perSheet, plainText, type SheetLayout } from './sheet'

const L: SheetLayout = { cols: 3, rows: 8, width: 70, height: 37, top: 0, left: 0, gapX: 0, gapY: 0 }

describe('sheet', () => {
  it('every preset fits on A4', () => {
    for (const p of SHEET_PRESETS) expect(layoutError(p.layout), p.id).toBeNull()
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
