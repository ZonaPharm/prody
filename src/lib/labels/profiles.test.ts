import { describe, expect, it } from 'vitest'
import { layoutToRow, profileCreateSchema, profileFromRow, profileUpdateSchema } from './profiles'
import { SHEET_PRESETS } from './sheet'

const L = SHEET_PRESETS[0].layout

describe('label sheet profiles', () => {
  it('accepts a name and a layout that fits', () => {
    const r = profileCreateSchema.safeParse({ name: '  24   Офис принтер ', layout: { ...L, offsetY: -1.5 } })
    expect(r.success).toBe(true)
    expect(r.data!.name).toBe('24 Офис принтер')
  })

  it('fills missing offsets with 0', () => {
    const old: Partial<typeof L> = { ...L }
    delete old.offsetX
    delete old.offsetY
    const r = profileCreateSchema.safeParse({ name: 'Стар', layout: old })
    expect(r.success).toBe(true)
    expect(r.data!.layout.offsetX).toBe(0)
  })

  it('refuses a layout that does not fit, an empty name, a big offset', () => {
    expect(profileCreateSchema.safeParse({ name: 'X', layout: { ...L, cols: 4 } }).error?.issues[0].message).toMatch(/ширина/)
    expect(profileCreateSchema.safeParse({ name: '  ', layout: L }).success).toBe(false)
    expect(profileCreateSchema.safeParse({ name: 'X', layout: { ...L, offsetX: 30 } }).success).toBe(false)
    expect(profileCreateSchema.safeParse({ name: 'X', layout: { ...L, cols: 2.5 } }).success).toBe(false)
  })

  it('an update needs a name or a layout', () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(false)
    expect(profileUpdateSchema.safeParse({ name: 'Ново' }).success).toBe(true)
  })

  it('goes to a row and back unchanged', () => {
    const l = { ...SHEET_PRESETS[3].layout, offsetX: 1.25, offsetY: -0.5 }
    const row = layoutToRow(l)
    expect(row.left_mm).toBe(4.75)
    // numerics come back from PostgREST as text
    const asText = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]))
    expect(profileFromRow({ id: 'x', name: 'P', ...asText }).layout).toEqual(l)
  })
})
