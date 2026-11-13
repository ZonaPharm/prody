import { describe, expect, it } from 'vitest'
import { evaluateIntegrity, type DeliveriesInput, type IntegrityInput } from './integrity-rules'

const STORE = { id: 'store-1', name: 'Ботев' }

function input(overrides: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: 5 }],
    batches: [{ product_id: 'p1', store_id: STORE.id, quantity_remaining: 5 }],
    recentSales: [{ id: 's1' }],
    movementSaleIds: ['s1'],
    ...overrides,
  }
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
})

describe('deliveries', () => {
  const OFFICE = { id: 'office', name: 'Офис', is_warehouse: true }
  const NOW = Date.parse('2026-11-10T03:00:00Z')
  const DAY = 24 * 60 * 60 * 1000

  /** One delivery of p1: 10 received, 6 planned for Ботев, 4 ready, 2 shipped; 2 still in Офис. */
  function deliveries(overrides: Partial<DeliveriesInput> = {}): DeliveriesInput {
    return {
      stores: [OFFICE, { ...STORE, is_warehouse: false }],
      deliveries: [{ id: 'd1', number: 124, status: 'in_progress' }],
      items: [{ id: 'i1', delivery_id: 'd1', product_id: 'p1', received_qty: 10 }],
      plans: [{
        id: 'pl1', delivery_item_id: 'i1', store_id: STORE.id,
        planned_qty: 6, ready_qty: 4, shipped_qty: 2,
      }],
      sentShipments: [],
      now: NOW,
      ...overrides,
    }
  }

  function withDeliveries(d: IntegrityInput['deliveries']) {
    return input({
      products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: 5 }],
      batches: [
        { product_id: 'p1', store_id: 'office', quantity_remaining: 2 },
        { product_id: 'p1', store_id: STORE.id, quantity_remaining: 3 },
      ],
      deliveries: d,
    })
  }

  it('passes consistent delivery data with no findings', () => {
    const report = evaluateIntegrity(withDeliveries(deliveries()))

    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
  })

  it('does not run the delivery checks when no delivery data is given', () => {
    expect(evaluateIntegrity(input()).findings).toEqual([])
  })

  describe('delivery_plan_counters', () => {
    it('flags a plan row shipped above ready', () => {
      const report = evaluateIntegrity(withDeliveries(deliveries({
        plans: [{ id: 'pl1', delivery_item_id: 'i1', store_id: STORE.id, planned_qty: 6, ready_qty: 2, shipped_qty: 3 }],
      })))

      expect(report.ok).toBe(false)
      expect(checksIn(report)).toEqual(['delivery_plan_counters'])
      expect(report.findings[0].detail[0]).toBe('Д-000124, Продукт 1 → Ботев: планирано 6, готово 2, изпратено 3')
    })

    it('flags a plan row ready above planned', () => {
      const report = evaluateIntegrity(withDeliveries(deliveries({
        plans: [{ id: 'pl1', delivery_item_id: 'i1', store_id: STORE.id, planned_qty: 3, ready_qty: 4, shipped_qty: 2 }],
      })))

      expect(checksIn(report)).toEqual(['delivery_plan_counters'])
    })
  })

  it('flags an item with more ready across its plan rows than received', () => {
    const report = evaluateIntegrity(withDeliveries(deliveries({
      items: [{ id: 'i1', delivery_id: 'd1', product_id: 'p1', received_qty: 5 }],
      plans: [
        { id: 'pl1', delivery_item_id: 'i1', store_id: STORE.id, planned_qty: 4, ready_qty: 4, shipped_qty: 4 },
        { id: 'pl2', delivery_item_id: 'i1', store_id: 'store-2', planned_qty: 4, ready_qty: 2, shipped_qty: 2 },
      ],
    })))

    expect(report.ok).toBe(false)
    expect(checksIn(report)).toEqual(['delivery_ready_within_received'])
    expect(report.findings[0].detail[0]).toBe('Д-000124, Продукт 1: готови 6, получени 5')
  })

  describe('delivery_ready_stock_in_warehouse', () => {
    it('warns when Офис holds less than is ready and not shipped', () => {
      const report = evaluateIntegrity(withDeliveries(deliveries({
        plans: [{ id: 'pl1', delivery_item_id: 'i1', store_id: STORE.id, planned_qty: 6, ready_qty: 5, shipped_qty: 2 }],
      })))

      expect(report.ok).toBe(true)
      expect(checksIn(report)).toEqual(['delivery_ready_stock_in_warehouse'])
      expect(report.findings[0].severity).toBe('warning')
      expect(report.findings[0].detail[0]).toBe('Продукт 1: готови 3, в Офис 2')
    })

    it('counts only Офис batches, not the stores', () => {
      const report = evaluateIntegrity({
        ...withDeliveries(deliveries()),
        batches: [{ product_id: 'p1', store_id: STORE.id, quantity_remaining: 5 }],
      })

      expect(checksIn(report)).toEqual(['delivery_ready_stock_in_warehouse'])
    })

    it('ignores plan rows of cancelled and completed deliveries', () => {
      for (const status of ['cancelled', 'completed']) {
        const report = evaluateIntegrity({
          ...withDeliveries(deliveries({ deliveries: [{ id: 'd1', number: 124, status }] })),
          batches: [{ product_id: 'p1', store_id: STORE.id, quantity_remaining: 5 }],
        })

        expect(report.findings).toEqual([])
      }
    })
  })

  describe('shipments_unconfirmed', () => {
    it('warns about a shipment sent more than three days ago', () => {
      const report = evaluateIntegrity(withDeliveries(deliveries({
        sentShipments: [{ id: 's1', number: 45, store_id: STORE.id, sent_at: new Date(NOW - 4 * DAY).toISOString() }],
      })))

      expect(report.ok).toBe(true)
      expect(checksIn(report)).toEqual(['shipments_unconfirmed'])
      expect(report.findings[0].detail[0]).toBe('П-000045 → Ботев, изпратена 2026-11-06')
    })

    it('leaves a shipment sent less than three days ago alone', () => {
      const report = evaluateIntegrity(withDeliveries(deliveries({
        sentShipments: [{ id: 's1', number: 45, store_id: STORE.id, sent_at: new Date(NOW - 2 * DAY).toISOString() }],
      })))

      expect(report.findings).toEqual([])
    })
  })

  describe('when the delivery tables cannot be read', () => {
    it('reports missing tables as a warning and still runs the other checks', () => {
      const report = evaluateIntegrity(input({
        products: [{ id: 'p1', name: 'Продукт 1', status: 'active', quantity_on_hand: 10 }],
        deliveries: { unavailable: "Could not find the table 'public.deliveries'", missingTables: true },
      }))

      expect(checksIn(report)).toEqual(['stock_matches_batches', 'deliveries_unavailable'])
      expect(report.findings[1].severity).toBe('warning')
    })

    it('reports any other read failure as an error', () => {
      const report = evaluateIntegrity(input({
        deliveries: { unavailable: 'fetch failed', missingTables: false },
      }))

      expect(report.ok).toBe(false)
      expect(checksIn(report)).toEqual(['deliveries_unavailable'])
    })
  })
})
