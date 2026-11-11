import { describe, expect, it } from 'vitest'
import { eventText, formatDeliveryNumber, formatMoney, formatQtyWithPacks, lineStatus } from './format'

describe('numbers', () => {
  it('formats delivery numbers with six digits, and drafts without one', () => {
    expect(formatDeliveryNumber(124)).toBe('Д-000124')
    expect(formatDeliveryNumber(null)).toBe('Чернова')
  })

  it('formats money in euro with two decimals', () => {
    expect(formatMoney(5.4)).toMatch(/^5,40\s€$/)
    expect(formatMoney(null)).toBe('—')
  })

  it('shows boxes only when the line came in boxes', () => {
    expect(formatQtyWithPacks(120, 1)).toBe('120 бр.')
    expect(formatQtyWithPacks(120, 12)).toBe('120 бр. (10 кутии по 12)')
    expect(formatQtyWithPacks(12, 12)).toBe('12 бр. (1 кутия по 12)')
    expect(formatQtyWithPacks(30, 12)).toBe('30 бр. (2 кутии по 12 + 6 бр.)')
  })
})

describe('lineStatus follows the counters', () => {
  const plan = (planned: number, ready: number, shipped: number) => [{ planned_qty: planned, ready_qty: ready, shipped_qty: shipped }]

  it('walks Очаква се → Частично получен → Чака етикет → Готов → Частично изпратен → Изпратен', () => {
    expect(lineStatus({ quantity: 100, received_qty: 0, plan: plan(100, 0, 0) })).toBe('expected')
    expect(lineStatus({ quantity: 100, received_qty: 40, plan: plan(100, 0, 0) })).toBe('partially_received')
    expect(lineStatus({ quantity: 100, received_qty: 100, plan: plan(100, 30, 0) })).toBe('waiting_label')
    expect(lineStatus({ quantity: 100, received_qty: 100, plan: plan(100, 100, 0) })).toBe('ready')
    expect(lineStatus({ quantity: 100, received_qty: 100, plan: plan(100, 100, 30) })).toBe('partially_shipped')
    expect(lineStatus({ quantity: 100, received_qty: 100, plan: plan(100, 100, 100) })).toBe('shipped')
  })

  it('a received line with no plan stays in Офис', () => {
    expect(lineStatus({ quantity: 10, received_qty: 10, plan: [] })).toBe('received')
  })

  it('received units without a label make the line wait for a label, Офис units too', () => {
    expect(lineStatus({ quantity: 10, received_qty: 10, labelled_qty: 4, plan: [] })).toBe('waiting_label')
    expect(lineStatus({ quantity: 10, received_qty: 10, labelled_qty: 10, plan: [] })).toBe('received')
    expect(lineStatus({ quantity: 20, received_qty: 20, labelled_qty: 10, plan: plan(10, 10, 10) })).toBe('waiting_label')
  })
})

describe('eventText', () => {
  it('reads each log entry as one sentence', () => {
    expect(eventText({ type: 'created', qty: null, details: {} })).toBe('Създадена чернова')
    expect(eventText({ type: 'saved', qty: null, details: { number: 124, items: 3 } })).toBe('Записана като Д-000124, 3 реда')
    expect(eventText({ type: 'received', qty: 40, details: {}, product_name: 'Крем', store_name: 'Офис' })).toBe('Получени 40 бр. „Крем“ в Офис')
    expect(eventText({ type: 'ready', qty: 6, details: { auto: true }, product_name: 'Чай', store_name: 'Варна' })).toBe('Готови без етикет 6 бр. „Чай“ за Варна')
    expect(eventText({ type: 'signal_raised', qty: 8, details: { step: 'receive', reason: 'short', qty_expected: 10, qty_actual: 8 }, product_name: 'Крем' }))
      .toBe('Не е наред при получаване: По-малко „Крем“ (очаквани 10, реално 8)')
    expect(eventText({ type: 'cancelled', qty: null, details: { reason: 'грешка' } })).toBe('Отказана: грешка')
    expect(eventText({ type: 'labelled', qty: 20, details: {}, product_name: 'Крем' })).toBe('Етикетирани 20 бр. „Крем“')
    expect(eventText({ type: 'ready', qty: 10, details: { auto: 'label' }, product_name: 'Крем', store_name: 'Ботев' })).toBe('Готови 10 бр. „Крем“ за Ботев')
    expect(eventText({ type: 'ready', qty: -4, details: { plan: true }, product_name: 'Крем', store_name: 'Ботев' }))
      .toBe('Махнати от готовите 4 бр. „Крем“ за Ботев (променен план)')
    expect(eventText({ type: 'trip_changed', qty: 7, details: { action: 'added' } })).toBe('Добавени 7 бр. в курса')
    expect(eventText({ type: 'trip_changed', qty: 4, details: { action: 'removed', reason: 'не се събра' }, store_name: 'Варна' }))
      .toBe('Пратката е махната от курса (Варна): не се събра')
    expect(eventText({ type: 'unpacked', qty: null, details: { box_count: 2 } })).toBe('Опаковането е отворено отново')
  })
})
