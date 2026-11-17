import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ProductGrid } from './product-grid'

// 17.11.2026: after the release the till on a computer showed only the first
// suppliers (categories) that fit on one line; Панацея and everything after it
// could not be reached, because the row scrolled sideways with its scrollbar
// hidden and a mouse cannot swipe. Now: one line, "Покажи още" opens the rest
// (src/components/pos/category-pills.tsx).

const SUPPLIERS = [
  'Durex/ Bilka', 'Арома', 'Витамаг', 'Зеолитни продукти', 'Зонафарм',
  'Лабораторни комплекти', 'Натурпродукт', 'Панацея', 'Рома', 'Софарма', 'Temu',
].map((name, i) => ({ id: `c${i}`, name }))

function render() {
  return renderToStaticMarkup(createElement(ProductGrid, {
    products: [], categories: SUPPLIERS, frequentlySold: [], onAddToCart: () => {},
  }))
}

function categoryRowClasses(html: string): string[] {
  const m = html.match(/<div data-testid="till-categories" class="([^"]*)"/)
  expect(m, 'category row is drawn').not.toBeNull()
  return m![1].split(/\s+/)
}

describe('till categories (suppliers)', () => {
  it('draws a pill for every supplier', () => {
    const html = render()
    for (const s of SUPPLIERS) expect(html).toContain(`>${s.name}</button>`)
  })

  it('is one line that wraps, never a sideways scroll a mouse cannot reach', () => {
    const cls = categoryRowClasses(render())
    expect(cls).toContain('flex-wrap')
    expect(cls).not.toContain('overflow-x-auto')
  })

  it('closed, shows only the first line (the rest under "Покажи още")', () => {
    const cls = categoryRowClasses(render())
    expect(cls).toContain('max-h-10')
    expect(cls).toContain('overflow-hidden')
  })

  it('shows the suppliers in the order given (most sold first)', () => {
    const html = render()
    const at = SUPPLIERS.map(s => html.indexOf(`>${s.name}</button>`))
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })
})

describe('.no-scrollbar', () => {
  const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8')

  it('hides the scrollbar only on touch screens, never for a mouse', () => {
    const media = css.indexOf('@media (hover: none) and (pointer: coarse)')
    expect(media).toBeGreaterThan(-1)
    // Every rule of the utility sits inside that media block.
    const block = css.slice(media, css.indexOf('\n  }\n', media) + 4)
    const all = css.match(/\.no-scrollbar[^{]*\{/g) ?? []
    const inside = block.match(/\.no-scrollbar[^{]*\{/g) ?? []
    expect(all.length).toBeGreaterThan(0)
    expect(inside).toEqual(all)
  })
})
