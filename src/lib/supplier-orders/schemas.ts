import { z } from 'zod'
import { isEmail } from './format'

/** What the order API routes accept; the database functions check the rules again. */

const id = z.guid('Невалиден идентификатор')

/** Per-store split of a line; what is not listed stays in Офис. The supplier never sees it. */
export const orderPlanSchema = z
  .array(z.object({
    store_id: id,
    planned_qty: z.number().int('Бройките са цяло число').min(0).max(1_000_000),
  }))
  .max(100)

export const orderLineSchema = z.object({
  product_id: id,
  quantity: z.number().int('Бройките са цяло число').min(1, 'Бройките са поне 1').max(1_000_000),
  note: z.string().trim().max(300).nullable().optional(),
  plan: orderPlanSchema.optional(),
})

export const orderSaveSchema = z.object({
  id: id.nullable().optional(),
  expected_updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  supplier_id: id,
  notes: z.string().trim().max(2000).nullable().optional(),
  items: z.array(orderLineSchema).max(500, 'Най-много 500 реда в една поръчка'),
})
export type OrderSave = z.infer<typeof orderSaveSchema>

/** Only the split, for a draft or a sent order (until the goods arrive). */
export const orderPlanSaveSchema = z.object({
  expected_updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  items: z.array(z.object({ product_id: id, plan: orderPlanSchema })).min(1, 'Няма редове').max(500),
})
export type OrderPlanSave = z.infer<typeof orderPlanSaveSchema>

export const orderSendSchema = z.object({
  via: z.enum(['email', 'manual']),
})

export const orderCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Напишете причина (поне 3 знака)').max(500),
})

export const orderSettingsSchema = z.object({
  order_signature: z.string().trim().max(1000).nullable(),
})

export const supplierEmailsSchema = z
  .array(z.string().trim().toLowerCase().refine(isEmail, { message: 'Невалиден имейл' }))
  .max(5, 'Най-много 5 имейла')
