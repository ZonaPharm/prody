import { describe, expect, it } from 'vitest'
import { missingLabelKind, selectWithLabelKind, withoutLabelKind } from './label-kind-compat'

describe('before the label_kind migration', () => {
  it('recognises the missing column, and only that', () => {
    expect(missingLabelKind({ code: '42703', message: 'column products_1.label_kind does not exist' })).toBe(true)
    expect(missingLabelKind({ code: 'PGRST204', message: "Could not find the 'label_kind' column of 'products' in the schema cache" })).toBe(true)
    expect(missingLabelKind({ code: '42703', message: 'column products.foo does not exist' })).toBe(false)
    expect(missingLabelKind({ code: '23505', message: 'label_kind' })).toBe(false)
    expect(missingLabelKind(null)).toBe(false)
  })

  it('drops the column from a list, embedded or not', () => {
    expect(withoutLabelKind('id, name, needs_label, label_kind, quantity_on_hand')).toBe('id, name, needs_label, quantity_on_hand')
    expect(withoutLabelKind('product:products(name, needs_label, label_kind, images:product_images(url))')).toBe('product:products(name, needs_label, images:product_images(url))')
    expect(withoutLabelKind('label_kind, id')).toBe('id')
  })

  it('reads again without the column only when it is missing', async () => {
    const seen: string[] = []
    const res = await selectWithLabelKind('id, label_kind', async cols => {
      seen.push(cols)
      return cols.includes('label_kind')
        ? { data: null, error: { code: '42703', message: 'column products.label_kind does not exist' } }
        : { data: [{ id: 1 }], error: null }
    })
    expect(seen).toEqual(['id, label_kind', 'id'])
    expect(res.data).toEqual([{ id: 1 }])

    const once: string[] = []
    await selectWithLabelKind('id, label_kind', async cols => { once.push(cols); return { data: [], error: null } })
    expect(once).toEqual(['id, label_kind'])
  })
})
