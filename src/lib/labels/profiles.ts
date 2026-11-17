import { z } from 'zod'
import { layoutError, type SheetLayout } from './sheet'

/**
 * Label paper profiles people save (table label_sheet_profiles): a name and a
 * sheet layout. The built-in sheets stay in sheet.ts; these come after them.
 */

export type SheetProfile = { id: string; name: string; layout: SheetLayout }

const mm = (min: number, max: number) => z.number().finite().min(min).max(max)

export const layoutSchema = z
  .object({
    cols: z.number().int('Колоните са цяло число').min(1).max(20),
    rows: z.number().int('Редовете са цяло число').min(1).max(40),
    width: mm(15, 210),
    height: mm(10, 297),
    top: mm(0, 297),
    left: mm(0, 210),
    gapX: mm(0, 100),
    gapY: mm(0, 100),
    offsetX: mm(-20, 20).default(0),
    offsetY: mm(-20, 20).default(0),
  })
  .superRefine((l, ctx) => {
    const error = layoutError(l)
    if (error) ctx.addIssue({ code: 'custom', message: error })
  })

const name = z.string().trim().min(1, 'Въведете име на профила').max(60, 'Името е до 60 знака').transform(s => s.replace(/\s+/g, ' '))

export const profileCreateSchema = z.object({ name, layout: layoutSchema })
export const profileUpdateSchema = z
  .object({ name: name.optional(), layout: layoutSchema.optional() })
  .refine(b => b.name !== undefined || b.layout !== undefined, 'Няма какво да се промени')

export const PROFILE_COLUMNS =
  'id, name, cols, rows, width_mm, height_mm, top_mm, left_mm, gap_x_mm, gap_y_mm, offset_x_mm, offset_y_mm'

/** Round to 0.01 mm, as the table keeps it. */
const r2 = (n: number) => Math.round(n * 100) / 100

export function layoutToRow(l: SheetLayout) {
  return {
    cols: l.cols,
    rows: l.rows,
    width_mm: r2(l.width),
    height_mm: r2(l.height),
    top_mm: r2(l.top),
    left_mm: r2(l.left),
    gap_x_mm: r2(l.gapX),
    gap_y_mm: r2(l.gapY),
    offset_x_mm: r2(l.offsetX ?? 0),
    offset_y_mm: r2(l.offsetY ?? 0),
  }
}

/** A row of label_sheet_profiles (numerics may come back as text). */
export function profileFromRow(r: any): SheetProfile {
  const n = (v: unknown) => Number(v ?? 0)
  return {
    id: r.id,
    name: r.name,
    layout: {
      cols: n(r.cols),
      rows: n(r.rows),
      width: n(r.width_mm),
      height: n(r.height_mm),
      top: n(r.top_mm),
      left: n(r.left_mm),
      gapX: n(r.gap_x_mm),
      gapY: n(r.gap_y_mm),
      offsetX: n(r.offset_x_mm),
      offsetY: n(r.offset_y_mm),
    },
  }
}
