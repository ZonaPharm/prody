import { describe, expect, it } from 'vitest'
import { searchPattern, toDeliveryProducts } from './products'
import { canonicalSupplierKey, supplierForSource } from './suppliers'

const suppliers = [
  { id: 's-temu', name: 'Temu', is_active: true },
  { id: 's-pan', name: 'Панацея 2001', is_active: true },
  { id: 's-old', name: 'Аксон', is_active: false },
]

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Крем', sku: 'K1', status: 'active', price: '8.90', cost_price: '4.20', source: 'Тему',
  needs_label: true, quantity_on_hand: 3,
  images: [{ url: 'b.jpg', is_primary: false, sort_order: 0 }, { url: 'a.jpg', is_primary: true, sort_order: 1 }],
  ...over,
})

describe('supplier of an old product', () => {
  it('matches "Източник" with the merges of the seed', () => {
    expect(canonicalSupplierKey(' Тему ')).toBe('temu')
    expect(supplierForSource('Панацея', suppliers)?.id).toBe('s-pan')
    expect(supplierForSource('Непознат', suppliers)).toBeNull()
    expect(supplierForSource(null, suppliers)).toBeNull()
  })
})

describe('toDeliveryProducts', () => {
  it('suggests the supplier and cost of the last delivery line', () => {
    const [p] = toDeliveryProducts([product()], [
      { product_id: 'p1', supplier_id: 's-pan', unit_cost: '5.1000', pack_size: 12 },
      { product_id: 'p1', supplier_id: 's-temu', unit_cost: '3', pack_size: 1 },
    ], suppliers)
    expect(p.suggested).toEqual({ supplier_id: 's-pan', unit_cost: 5.1, pack_size: 12 })
    expect(p.image).toBe('a.jpg')
    expect(p.price).toBe(8.9)
  })

  it('without deliveries, takes "Източник" and the catalogue cost', () => {
    const [p] = toDeliveryProducts([product()], [], suppliers)
    expect(p.suggested).toEqual({ supplier_id: 's-temu', unit_cost: 4.2, pack_size: 1 })
  })

  it('does not suggest a supplier that was switched off', () => {
    const [p] = toDeliveryProducts([product()], [{ product_id: 'p1', supplier_id: 's-old', unit_cost: 1, pack_size: 1 }], suppliers)
    expect(p.suggested.supplier_id).toBeNull()
  })
})

describe('searchPattern', () => {
  it('drops characters that would break the or=() filter', () => {
    expect(searchPattern('крем, (ръце)')).toBe('%крем ръце%')
    expect(searchPattern(' a ')).toBeNull()
  })
})
