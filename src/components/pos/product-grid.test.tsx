import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ProductGrid } from './product-grid'

// 17.11.2026: after the release the till on a computer showed only the first
// suppliers (categories) that fit on one line; Панацея and everything after it
// could not be reached, because the row scrolled sideways with its scrollbar
// hidden and a mouse cannot swipe.

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

  it('on a computer wraps onto more lines instead of scrolling out of reach', () => {
    const cls = categoryRowClasses(render())
    expect(cls).toContain('lg:flex-wrap')
    expect(cls).toContain('lg:overflow-visible')
  })

  it('on a phone still swipes sideways on one line', () => {
    const cls = categoryRowClasses(render())
    expect(cls).toContain('overflow-x-auto')
    expect(cls).not.toContain('flex-wrap')
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
