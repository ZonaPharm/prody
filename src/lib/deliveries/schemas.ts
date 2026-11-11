import { z } from 'zod'

/**
 * What the delivery API routes accept. Checked on the server before anything
 * reaches the database; the database functions check the stock rules again.
 */

const id = z.guid('Невалиден идентификатор')
const units = (max = 1_000_000) => z.number().int('Цяло число бройки').min(0).max(max)

export const draftItemSchema = z.object({
  id: id.nullable().optional(),
  key: z.string().max(64).optional(),
  product_id: id,
  supplier_id: id.nullable().optional(),
  doc_number: z.string().trim().max(100).nullable().optional(),
  pack_size: z.number().int().min(1, 'Кутията е поне 1 бр.').max(100_000).default(1),
  quantity: z.number().int('Количеството е цяло число').min(1, 'Количеството е поне 1').max(1_000_000),
  unit_cost: z.number().min(0, 'Доставната цена не може да е отрицателна').max(1_000_000),
  needs_label: z.boolean().nullable().optional(),
  plan: z.array(z.object({ store_id: id, planned_qty: units() })).max(100).default([]),
})

export const draftSaveSchema = z.object({
  id: id.nullable().optional(),
  expected_updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  draft: z.object({
    order_ref: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    items: z.array(draftItemSchema).max(3000, 'Най-много 3000 реда в една доставка'),
  }),
})
export type DraftSave = z.infer<typeof draftSaveSchema>
export type DraftItem = z.infer<typeof draftItemSchema>

export const RECEIVE_SIGNAL_REASONS = ['short', 'damaged', 'wrong_product', 'missing', 'other'] as const

export const receiveSchema = z
  .object({
    lines: z.array(z.object({ item_id: id, qty: z.number().int().min(1).max(1_000_000) })).max(3000).default([]),
    signals: z
      .array(
        z.object({
          item_id: id,
          reason: z.enum(RECEIVE_SIGNAL_REASONS),
          qty_expected: units().nullable().optional(),
          qty_actual: units().nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
        }),
      )
      .max(3000)
      .default([]),
  })
  .refine(v => v.lines.length > 0 || v.signals.length > 0, {
    message: 'Нищо не е отметнато: отметнете получените редове или отбележете „Не е наред“',
  })
  .refine(v => v.signals.every(s => s.reason !== 'other' || (s.note && s.note.length > 0)), {
    message: 'За причина „Друго“ напишете кратка бележка',
  })
export type ReceiveInput = z.infer<typeof receiveSchema>

export const planUpdateSchema = z.object({
  rows: z.array(z.object({ store_id: id, planned_qty: units() })).min(1, 'Няма редове за плана').max(100),
})

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Напишете причина (поне 3 знака)').max(500),
})

export const newProductSchema = z.object({
  name: z.string().trim().min(2, 'Името е поне 2 знака').max(200),
  price: z.number().positive('Продажната цена трябва да е над 0').max(1_000_000),
  category_id: id.nullable().optional(),
  supplier_id: id.nullable().optional(),
  needs_label: z.boolean().default(true),
})

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, 'Въведете име').max(120),
  notes: z.string().trim().max(1000).nullable().optional(),
})

export const supplierUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Въведете име').max(120).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine(v => Object.keys(v).length > 0, { message: 'Няма промени' })

// ---------------------------------------------------------------------------
// Phase 3: labelling, trips, packing, the driver, the store, the problems.
// ---------------------------------------------------------------------------

const note = z.string().trim().max(500).nullable().optional()
const needsNote = (s: { reason?: string; note?: string | null }) => s.reason !== 'other' || !!(s.note && s.note.length > 0)
const OTHER_NOTE = { message: 'За причина „Друго“ напишете кратка бележка' }

export const STEP_SIGNAL_REASONS = ['damaged', 'wrong_label', 'wrong_product', 'missing', 'other'] as const

const stepSignal = {
  reason: z.enum(STEP_SIGNAL_REASONS),
  qty_expected: units().nullable().optional(),
  qty_actual: units().nullable().optional(),
  note,
}

export const readySchema = z
  .object({
    rows: z.array(z.object({ item_id: id, qty: z.number().int().min(1).max(1_000_000) })).max(5000).default([]),
    signals: z.array(z.object({ item_id: id, ...stepSignal }).refine(needsNote, OTHER_NOTE)).max(5000).default([]),
  })
  .refine(v => v.rows.length > 0 || v.signals.length > 0, {
    message: 'Нищо не е отметнато: отметнете етикетираните редове или отбележете „Не е наред“',
  })

export const tripCreateSchema = z.object({
  store_ids: z.array(id).min(1, 'Изберете поне един обект').max(100),
  notes: z.string().trim().max(500).nullable().optional(),
})

export const tripCancelSchema = cancelSchema

export const tripSendSchema = z.object({
  driver_id: id,
  password: z.string().min(1, 'Шофьорът въвежда паролата си').max(200),
})

export const packSchema = z.object({
  lines: z.array(z.object({ line_id: id, qty: units() })).min(1, 'Няма редове').max(5000),
  box_count: z.number().int('Цяло число кашони').min(1, 'Поне 1 кашон').max(10_000),
  signals: z.array(z.object({ line_id: id, ...stepSignal }).refine(needsNote, OTHER_NOTE)).max(5000).default([]),
})

export const STORE_SIGNAL_REASONS = ['short', 'damaged', 'wrong_product', 'missing', 'other'] as const

export const confirmSchema = z.object({
  lines: z
    .array(
      z
        .object({
          line_id: id,
          received_qty: units(),
          reason: z.enum(STORE_SIGNAL_REASONS).optional(),
          note,
        })
        .refine(needsNote, OTHER_NOTE),
    )
    .min(1, 'Няма редове')
    .max(5000),
})

export const SIGNAL_RESOLUTIONS = ['corrected', 'returned_to_supplier', 'found', 'other'] as const

export const resolveSchema = z.object({
  resolution: z.enum(SIGNAL_RESOLUTIONS, 'Изберете решение'),
  note: z.string().trim().max(500).nullable().optional(),
})

/** The first problem as one Bulgarian sentence, for a 400 answer. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Невалидни данни'
  return issue.message || 'Невалидни данни'
}
