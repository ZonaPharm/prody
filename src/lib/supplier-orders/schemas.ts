import { z } from 'zod'
import { isEmail } from './format'

/** What the order API routes accept; the database functions check the rules again. */

const id = z.guid('Невалиден идентификатор')

export const orderLineSchema = z.object({
  product_id: id,
  quantity: z.number().int('Бройките са цяло число').min(1, 'Бройките са поне 1').max(1_000_000),
  note: z.string().trim().max(300).nullable().optional(),
})

export const orderSaveSchema = z.object({
  id: id.nullable().optional(),
  expected_updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  supplier_id: id,
  notes: z.string().trim().max(2000).nullable().optional(),
  items: z.array(orderLineSchema).max(500, 'Най-много 500 реда в една поръчка'),
})
export type OrderSave = z.infer<typeof orderSaveSchema>

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
