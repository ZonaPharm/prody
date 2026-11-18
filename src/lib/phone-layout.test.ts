import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// A CSS grid with no column count of its own gets one column sized to its
// widest content. A long product name in a `truncate` line then no longer gets
// cut with "…": it pushes the whole page wider than a phone and the page
// scrolls sideways (Пратки at the seller, 2026-11-17). `grid-cols-1` is a
// column that never grows past the screen, so every grid has to say how many
// columns it has on a phone, even when that is one.

const SRC = join(__dirname, '..')

// Being changed in another pull request (the order plan); fixed there.
const ELSEWHERE = new Set([
  'components/supplier-orders/order-editor.tsx',
  'components/deliveries/delivery-editor.tsx',
])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : []
  })
}

/** Class lists that make a grid on a phone without saying how many columns. */
function gridsWithoutColumns(code: string): string[] {
  const found: string[] = []
  for (const m of code.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
    const classes = m[2].split(/\s+/)
    if (!classes.includes('grid')) continue
    if (classes.some(c => c.startsWith('grid-cols-'))) continue
    // Columns set in a style next to it (StepTrail).
    const after = code.slice(m.index! + m[0].length, m.index! + m[0].length + 200)
    if (/gridTemplateColumns/.test(after)) continue
    found.push(m[2])
  }
  return found
}

describe('phone layout', () => {
  it('finds a grid without a column count', () => {
    expect(gridsWithoutColumns(`<ul className="grid gap-2 md:grid-cols-2">`)).toEqual(['grid gap-2 md:grid-cols-2'])
    expect(gridsWithoutColumns(`cn('grid gap-4', x && 'xl:grid-cols-2')`)).toEqual(['grid gap-4'])
    expect(gridsWithoutColumns(`<ul className="grid grid-cols-1 gap-2 md:grid-cols-2">`)).toEqual([])
    expect(gridsWithoutColumns(`<div className="hidden lg:grid">`)).toEqual([])
    expect(gridsWithoutColumns(`<ol className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>`)).toEqual([])
  })

  it('every grid in the app says how many columns it has on a phone', () => {
    const offenders = sources(SRC)
      .map(path => relative(SRC, path).split('\\').join('/'))
      .filter(file => !file.startsWith('components/ui/') && !ELSEWHERE.has(file))
      .flatMap(file => gridsWithoutColumns(readFileSync(join(SRC, file), 'utf8')).map(cls => `${file}: "${cls}"`))
    expect(offenders).toEqual([])
  })
})
