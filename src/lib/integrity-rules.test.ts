import { describe, expect, it } from 'vitest'
import { evaluateIntegrity, type IntegrityInput } from './integrity-rules'

const STORE = { id: 'store-1', name: 'Ботев' }

function input(overrides: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: 5 }],
    batches: [{ product_id: 'p1', store_id: STORE.id, quantity_remaining: 5 }],
    stores: [STORE],
    recentSales: [{ id: 's1' }],
    movementSaleIds: ['s1'],
    ...overrides,
  }
}

/** n distinct products, each with one batch of stock in the given store. */
function storeHolding(n: number, storeId = STORE.id): IntegrityInput['batches'] {
  return Array.from({ length: n }, (_, i) => ({ product_id: `p${i}`, store_id: storeId, quantity_remaining: 1 }))
}

const checksIn = (report: ReturnType<typeof evaluateIntegrity>) => report.findings.map(f => f.check)

describe('evaluateIntegrity', () => {
  it('passes clean data with no findings', () => {
    const report = evaluateIntegrity(input())

    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
  })

  describe('stock_matches_batches', () => {
    it('flags an active product whose counter differs from its batches', () => {
      const report = evaluateIntegrity(input({
        products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: 10 }],
      }))

      expect(report.ok).toBe(false)
      expect(checksIn(report)).toEqual(['stock_matches_batches'])
      expect(report.findings[0].title).toContain('+5')
    })

    it('ignores an inactive product, since it is not on sale', () => {
      const report = evaluateIntegrity(input({
        products: [{ id: 'p1', name: 'Продукт 1', status: 'inactive', quantity_on_hand: 10 }],
      }))

      expect(report.findings).toEqual([])
    })

    it('sums every batch of a product across stores before comparing', () => {
      const report = evaluateIntegrity(input({
        products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: 7 }],
        batches: [
          { product_id: 'p1', store_id: 'store-1', quantity_remaining: 3 },
          { product_id: 'p1', store_id: 'store-2', quantity_remaining: 4 },
        ],
      }))

      expect(report.findings).toEqual([])
    })
  })

  it('flags a batch that has gone negative', () => {
    const report = evaluateIntegrity(input({
      products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: -1 }],
      batches: [{ product_id: 'p1', store_id: STORE.id, quantity_remaining: -1 }],
    }))

    expect(report.ok).toBe(false)
    expect(checksIn(report)).toContain('no_negative_batches')
  })

  it('flags a sale with no stock movement behind it', () => {
    const report = evaluateIntegrity(input({
      recentSales: [{ id: 's1' }, { id: 's2' }],
      movementSaleIds: ['s1'],
    }))

    expect(report.ok).toBe(false)
    expect(checksIn(report)).toEqual(['sales_have_movements'])
    expect(report.findings[0].detail).toContain('продажба s2')
  })

  // This alarm is what stands between the catalogue's store filter and an empty
  // page: the filter puts every product id in the URL, which breaks near 398.
  describe('store_filter_headroom', () => {
    const headroom = (batches: IntegrityInput['batches']) =>
      evaluateIntegrity(input({ products: [], batches, recentSales: [], movementSaleIds: [] }))

    it('stays quiet below 360 products in a store', () => {
      expect(headroom(storeHolding(359)).findings).toEqual([])
    })

    it('warns from 360, without failing the report', () => {
      const report = headroom(storeHolding(360))

      expect(report.ok).toBe(true)
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0].severity).toBe('warning')
    })

    it('fails the report from 390 — where Ботев stood at 391 on 9 November 2026', () => {
      const report = headroom(storeHolding(391))

      expect(report.ok).toBe(false)
      expect(report.findings[0].severity).toBe('error')
      expect(report.findings[0].detail[0]).toBe('Ботев: 391 продукта (лимит около 398)')
    })

    it('counts distinct products, not batch rows', () => {
      const twoBatchesEach = [...storeHolding(359), ...storeHolding(359)]

      expect(headroom(twoBatchesEach).findings).toEqual([])
    })

    it('leaves out batches that have run empty', () => {
      const emptied = storeHolding(400).map(b => ({ ...b, quantity_remaining: 0 }))

      expect(headroom(emptied).findings).toEqual([])
    })
  })
})
